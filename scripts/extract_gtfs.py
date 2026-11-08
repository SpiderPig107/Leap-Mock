#!/usr/bin/env python3
"""Extract route data from the Dublin Bus and Go-Ahead Ireland GTFS feeds.

Output: public/gtfs/{route}.json (shape, ordered stops, one-day timetable per direction)
        public/gtfs/index.json   (route list for the route picker)
        api/_lib/routeIds.ts     (GTFS route_id -> short name lookup for the realtime proxy)

Usage: python3 scripts/extract_gtfs.py --gtfs GTFS_Dublin_Bus.zip --gtfs GTFS_GoAhead.zip [--date YYYYMMDD] [--routes all|E1,39A,16]
Feeds: https://www.transportforireland.ie/transitData/Data/GTFS_Dublin_Bus.zip and .../GTFS_GoAhead.zip
"""
import argparse
import csv
import datetime as dt
import glob
import io
import json
import os
import re
import zipfile
from collections import Counter, defaultdict

MAX_SHAPE_POINTS = 200
ROOT = os.path.join(os.path.dirname(__file__), "..")
ROUTE_IDS_TS = os.path.join(ROOT, "api", "_lib", "routeIds.ts")


class Feed:
    def __init__(self, path):
        self.path = path
        self.zip = zipfile.ZipFile(path) if path.endswith(".zip") else None
        self.agency = next(self.rows("agency.txt"))["agency_name"]

    def rows(self, name):
        if self.zip:
            fh = io.TextIOWrapper(self.zip.open(name), encoding="utf-8-sig")
        else:
            fh = open(os.path.join(self.path, name), encoding="utf-8-sig", newline="")
        with fh:
            yield from csv.DictReader(fh)


def to_secs(hms):
    h, m, s = (int(x) for x in hms.split(":"))
    return h * 3600 + m * 60 + s


def active_services(feed, date):
    weekday = dt.datetime.strptime(date, "%Y%m%d").strftime("%A").lower()
    active = {
        r["service_id"]
        for r in feed.rows("calendar.txt")
        if r["start_date"] <= date <= r["end_date"] and r[weekday] == "1"
    }
    for r in feed.rows("calendar_dates.txt"):
        if r["date"] == date:
            (active.add if r["exception_type"] == "1" else active.discard)(r["service_id"])
    return active


def simplify(points, limit=MAX_SHAPE_POINTS):
    if len(points) <= limit:
        return points
    step = (len(points) - 1) / (limit - 1)
    return [points[round(i * step)] for i in range(limit)]


DUBLIN_BBOX = (53.18, 53.64, -6.56, -6.02)


def in_dublin(stop):
    min_lat, max_lat, min_lon, max_lon = DUBLIN_BBOX
    return min_lat <= stop["lat"] <= max_lat and min_lon <= stop["lon"] <= max_lon


def extract(feed, date, wanted, min_dublin_share):
    """Returns {short_name: route_json} for routes in this feed (all when wanted is None)."""
    routes = {r["route_id"]: r for r in feed.rows("routes.txt")}
    lookup = {rid: r["route_short_name"] for rid, r in routes.items()}
    by_short = {r["route_short_name"]: rid for rid, r in routes.items() if wanted is None or r["route_short_name"] in wanted}

    services = active_services(feed, date)
    trips = {}
    for t in feed.rows("trips.txt"):
        if t["route_id"] in by_short.values() and t["service_id"] in services:
            trips[t["trip_id"]] = t

    stop_times = defaultdict(list)
    for st in feed.rows("stop_times.txt"):
        if st["trip_id"] in trips:
            stop_times[st["trip_id"]].append((int(st["stop_sequence"]), st["stop_id"], to_secs(st["arrival_time"])))

    # Representative pattern per (route, direction): most common stop sequence.
    groups = defaultdict(list)
    for tid, sts in stop_times.items():
        sts.sort()
        t = trips[tid]
        groups[(lookup[t["route_id"]], t["direction_id"])].append(tid)

    needed_shapes, needed_stops, plan = set(), set(), {}
    for key, tids in groups.items():
        pattern = Counter(tuple(s[1] for s in stop_times[tid]) for tid in tids).most_common(1)[0][0]
        members = [tid for tid in tids if tuple(s[1] for s in stop_times[tid]) == pattern]
        shape_id = Counter(trips[tid]["shape_id"] for tid in members).most_common(1)[0][0]
        headsign = Counter(trips[tid]["trip_headsign"] for tid in members).most_common(1)[0][0]
        plan[key] = (pattern, members, shape_id, headsign)
        needed_shapes.add(shape_id)
        needed_stops.update(pattern)

    shapes = defaultdict(list)
    for p in feed.rows("shapes.txt"):
        if p["shape_id"] in needed_shapes:
            shapes[p["shape_id"]].append((int(p["shape_pt_sequence"]), float(p["shape_pt_lat"]), float(p["shape_pt_lon"])))
    stops = {
        s["stop_id"]: {
            "stopId": s["stop_id"],
            "code": s["stop_code"],
            "name": s["stop_name"],
            "lat": round(float(s["stop_lat"]), 6),
            "lon": round(float(s["stop_lon"]), 6),
        }
        for s in feed.rows("stops.txt")
        if s["stop_id"] in needed_stops
    }

    out = {}
    for short in sorted(by_short):
        directions = []
        for (route, direction), (pattern, members, shape_id, headsign) in sorted(plan.items()):
            if route != short:
                continue
            pts = [(round(lat, 6), round(lon, 6)) for _, lat, lon in sorted(shapes[shape_id])]
            timetable = []
            for tid in members:
                sts = stop_times[tid]
                start = sts[0][2]
                timetable.append({"tripId": tid, "startSecs": start, "stopOffsetsSecs": [s[2] - start for s in sts]})
            timetable.sort(key=lambda x: x["startSecs"])
            directions.append({
                "directionId": int(direction),
                "headsign": headsign,
                "shape": [list(p) for p in simplify(pts)],
                "stops": [stops[sid] for sid in pattern],
                "timetable": timetable,
            })
        if not directions:
            print(f"skip {short}: no trips on {date}")
            continue
        route_stops = {s["stopId"]: s for d in directions for s in d["stops"]}.values()
        share = sum(in_dublin(s) for s in route_stops) / len(route_stops)
        if share < min_dublin_share:
            print(f"skip {short}: only {share:.0%} of stops in Dublin")
            continue
        rid = by_short[short]
        out[short] = {
            "route": short,
            "routeId": rid,
            "longName": routes[rid]["route_long_name"],
            "operator": feed.agency,
            "serviceDate": date,
            "directions": directions,
        }
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gtfs", required=True, action="append", help="repeat for each operator feed")
    ap.add_argument("--date", default=dt.date.today().strftime("%Y%m%d"))
    ap.add_argument("--routes", default="all", help="comma-separated short names, or 'all'")
    ap.add_argument("--min-dublin-share", type=float, default=0.5, help="drop routes with fewer stops in Dublin")
    ap.add_argument("--out", default=os.path.join(ROOT, "public", "gtfs"))
    args = ap.parse_args()
    wanted = None if args.routes == "all" else set(args.routes.split(","))
    os.makedirs(args.out, exist_ok=True)

    found = {}
    for path in args.gtfs:
        feed = Feed(path)
        for short, data in extract(feed, args.date, wanted, args.min_dublin_share).items():
            if short in found:
                raise SystemExit(f"Route {short} is in more than one feed")
            found[short] = data
    if wanted and wanted - set(found):
        raise SystemExit(f"Routes not found: {sorted(wanted - set(found))}")
    if not found:
        raise SystemExit(f"No routes with trips on {args.date}")

    for old in glob.glob(os.path.join(args.out, "*.json")):
        os.remove(old)
    for short, data in found.items():
        with open(os.path.join(args.out, f"{short}.json"), "w") as fh:
            json.dump(data, fh, separators=(",", ":"))

    order = sorted(found, key=route_sort_key)
    index = [{"route": r, "longName": found[r]["longName"], "operator": found[r]["operator"]} for r in order]
    with open(os.path.join(args.out, "index.json"), "w") as fh:
        json.dump(index, fh, separators=(",", ":"))

    ids = "\n".join(f"  {json.dumps(found[r]['routeId'])}: {json.dumps(r)}," for r in order)
    with open(ROUTE_IDS_TS, "w") as fh:
        fh.write(
            "// Generated by scripts/extract_gtfs.py. Do not edit by hand.\n"
            "/** GTFS route_id -> route short name, for every route in public/gtfs/index.json. */\n"
            f"export const ROUTE_IDS: Record<string, string> = {{\n{ids}\n}};\n"
        )
    total = sum(os.path.getsize(os.path.join(args.out, f"{r}.json")) for r in found)
    print(f"{len(found)} routes, {total // 1024} KB total")


def route_sort_key(short):
    m = re.match(r"([A-Z]*)(\d*)(.*)", short)
    return (m.group(1), int(m.group(2) or 0), m.group(3))


if __name__ == "__main__":
    main()
