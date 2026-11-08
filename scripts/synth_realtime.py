#!/usr/bin/env python3
"""Generate synthetic RECORDED realtime snapshots (no NTA key needed).

Vehicles follow the demo-date timetable in public/gtfs/{route}.json: each active trip is placed
between its previous and next stop by schedule time, plus a small random delay.
Output: public/recorded/snap-000.json ... (same shape as RealtimeRes, source "RECORDED"),
        public/recorded/index.json (list of snapshot files).

Usage: python3 scripts/synth_realtime.py [--start 08:30] [--count 30] [--interval 20] [--seed 7] [--routes E1,39A,16]
"""
import argparse
import datetime as dt
import glob
import json
import math
import os
import random
import zlib
from zoneinfo import ZoneInfo

ROOT = os.path.join(os.path.dirname(__file__), "..", "public")


def bearing(a, b):
    lat1, lat2 = math.radians(a["lat"]), math.radians(b["lat"])
    dlon = math.radians(b["lon"] - a["lon"])
    y = math.sin(dlon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return round((math.degrees(math.atan2(y, x)) + 360) % 360)


def position(stops, offsets, elapsed):
    for i in range(1, len(offsets)):
        if elapsed <= offsets[i]:
            span = max(offsets[i] - offsets[i - 1], 1)
            f = (elapsed - offsets[i - 1]) / span
            a, b = stops[i - 1], stops[i]
            return a["lat"] + (b["lat"] - a["lat"]) * f, a["lon"] + (b["lon"] - a["lon"]) * f, bearing(a, b), i
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="08:30")
    ap.add_argument("--count", type=int, default=30)
    ap.add_argument("--interval", type=int, default=20)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--routes", default="E1,39A,16", help="routes to include in the RECORDED snapshots")
    args = ap.parse_args()
    rnd = random.Random(args.seed)

    routes = [json.load(open(os.path.join(ROOT, "gtfs", f"{r}.json"))) for r in args.routes.split(",")]
    if not routes:
        raise SystemExit("Run scripts/extract_gtfs.py first")
    dates = {r["serviceDate"] for r in routes}
    if len(dates) > 1:
        raise SystemExit(f"Route files have mixed service dates {sorted(dates)}; re-run extract_gtfs.py for all routes")
    service_date = dt.datetime.strptime(routes[0]["serviceDate"], "%Y%m%d").replace(tzinfo=ZoneInfo("Europe/Dublin"))
    h, m = (int(x) for x in args.start.split(":"))
    start_secs = h * 3600 + m * 60

    delays = {}
    out_dir = os.path.join(ROOT, "recorded")
    os.makedirs(out_dir, exist_ok=True)
    for old in glob.glob(os.path.join(out_dir, "snap-*.json")):
        os.remove(old)

    files = []
    for n in range(args.count):
        now = start_secs + n * args.interval
        vehicles, trip_delays = [], {}
        for r in routes:
            for d in r["directions"]:
                for trip in d["timetable"]:
                    tid = trip["tripId"]
                    delay = delays.setdefault(tid, rnd.choice([0, 0, 30, 60, 90, 120, 180, -30]))
                    elapsed = now - trip["startSecs"] - delay
                    if elapsed < 0 or elapsed > trip["stopOffsetsSecs"][-1]:
                        continue
                    pos = position(d["stops"], trip["stopOffsetsSecs"], elapsed)
                    if not pos:
                        continue
                    lat, lon, brg, seq = pos
                    ts = int((service_date + dt.timedelta(seconds=now)).timestamp())
                    vehicles.append({
                        "vehicleId": f"SIM-{zlib.crc32(tid.encode()) % 100000:05d}",
                        "route": r["route"],
                        "tripId": tid,
                        "lat": round(lat, 6),
                        "lon": round(lon, 6),
                        "bearing": brg,
                        "ts": ts,
                    })
                    trip_delays[tid] = {"delaySecs": delay, "stopSeq": seq + 1}
        snap = {
            "source": "RECORDED",
            "fetchedAt": (service_date + dt.timedelta(seconds=now)).astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
            "vehicles": vehicles,
            "tripDelays": trip_delays,
        }
        name = f"snap-{n:03d}.json"
        with open(os.path.join(out_dir, name), "w") as fh:
            json.dump(snap, fh, separators=(",", ":"))
        files.append(name)
    with open(os.path.join(out_dir, "index.json"), "w") as fh:
        json.dump({"synthetic": True, "intervalSecs": args.interval, "files": files}, fh, indent=1)
    print(f"{len(files)} snapshots, {len(vehicles)} vehicles in last snapshot")


if __name__ == "__main__":
    main()
