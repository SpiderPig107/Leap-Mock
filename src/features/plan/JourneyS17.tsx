import "leaflet/dist/leaflet.css";
import "../live/live.css";
import type { LatLngBoundsExpression } from "leaflet";
import { useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { BusMarker } from "../live/BusMarker";
import { useRouteIndex } from "../live/gtfs";
import { LiveBadge } from "../live/LiveBadge";
import { useRealtime } from "../live/useRealtime";
import { LegChips } from "./LegChips";
import { hhmm, isTransit, liveStatus, mins, modeColor, modeLabel, type JourneyLeg } from "./planApi";
import { usePlanStore } from "./planStore";
import { decodePolyline } from "./polyline";

const placeName = (n: string, fallback: string) => (!n || n === "END" || n === "START" ? fallback : n);
const ntaTrip = (l: JourneyLeg) => l.tripId?.match(/(\d+_\d+)$/)?.[1];

function FitBounds({ bounds }: { bounds: LatLngBoundsExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [28, 28] });
  }, [map, bounds]);
  return null;
}

/** S17 Selected journey: route map with walking/transit legs, stops and live buses, plus a leg timeline. */
export function JourneyS17() {
  const { idx } = useParams();
  const navigate = useNavigate();
  const it = usePlanStore((s) => s.itineraries?.[Number(idx)]);
  const routeIndex = useRouteIndex();

  const legs = useMemo(
    () => (it?.legs ?? []).map((l) => ({ leg: l, path: decodePolyline(l.geometry.points, l.geometry.precision) })),
    [it],
  );
  const bounds = useMemo<LatLngBoundsExpression | null>(() => {
    const pts = legs.flatMap((l) => l.path);
    return pts.length ? pts : null;
  }, [legs]);

  const liveRoutes = useMemo(() => {
    const known = new Set(routeIndex?.map((r) => r.route));
    return new Set(legs.filter((l) => isTransit(l.leg) && l.leg.route && known.has(l.leg.route)).map((l) => l.leg.route!));
  }, [legs, routeIndex]);
  const rt = useRealtime([...liveRoutes]);
  const myTrips = useMemo(() => new Set(legs.map((l) => ntaTrip(l.leg)).filter(Boolean)), [legs]);
  const vehicles = useMemo(() => rt.data?.vehicles.filter((v) => liveRoutes.has(v.route)) ?? [], [rt.data, liveRoutes]);
  const myBuses = vehicles.filter((v) => myTrips.has(v.tripId));
  const shown = myBuses.length ? myBuses : vehicles;

  if (!it) return <Navigate to="/plan" replace />;
  const firstDeparture = it.legs.find(isTransit)?.from.time;
  const departed = !!firstDeparture && Date.parse(firstDeparture) < Date.now();
  const first = legs[0]?.leg.from;
  const last = legs[legs.length - 1]?.leg.to;

  return (
    <div className="flex h-full flex-col">
      <div className="relative h-[46%] min-h-[240px] shrink-0">
        <MapContainer center={[53.3498, -6.2603]} zoom={12} zoomControl={false} className="h-full w-full">
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            maxZoom={19}
          />
          <FitBounds bounds={bounds} />
          {legs.map(({ leg, path }, i) => (
            <Polyline
              key={i}
              positions={path}
              pathOptions={
                isTransit(leg)
                  ? { color: modeColor(leg), weight: 6, opacity: 0.85 }
                  : { color: "#6B7280", weight: 4, opacity: 0.9, dashArray: "2 8", lineCap: "round" }
              }
            />
          ))}
          {legs.filter((l) => isTransit(l.leg)).flatMap(({ leg }, i) => [
            ...leg.stops.map((s, j) => (
              <CircleMarker key={`s${i}-${j}`} center={[s.lat, s.lon]} radius={3} pathOptions={{ color: modeColor(leg), weight: 2, fillColor: "#fff", fillOpacity: 1 }}>
                <Tooltip>{s.name}</Tooltip>
              </CircleMarker>
            )),
            ...[leg.from, leg.to].map((s, j) => (
              <CircleMarker key={`e${i}-${j}`} center={[s.lat, s.lon]} radius={6} pathOptions={{ color: modeColor(leg), weight: 3, fillColor: "#fff", fillOpacity: 1 }}>
                <Tooltip>{s.name}</Tooltip>
              </CircleMarker>
            )),
          ])}
          {first && <CircleMarker center={[first.lat, first.lon]} radius={8} pathOptions={{ color: "#111", weight: 3, fillColor: "#fff", fillOpacity: 1 }} />}
          {last && <CircleMarker center={[last.lat, last.lon]} radius={8} pathOptions={{ color: "#fff", weight: 3, fillColor: "#111", fillOpacity: 1 }} />}
          {shown.map((v) => (
            <BusMarker key={v.vehicleId} vehicle={v} />
          ))}
        </MapContainer>
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[1000] flex items-start justify-between p-3">
          <button
            onClick={() => navigate("/plan")}
            aria-label="Back to routes"
            className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-white text-2xl shadow-md"
          >
            ‹
          </button>
          {liveRoutes.size > 0 && (
            <div className="pointer-events-auto">
              <LiveBadge mode={rt.mode} fetchedAt={rt.data?.fetchedAt} onToggle={rt.toggle} />
            </div>
          )}
        </div>
      </div>

      <div className="relative z-[1001] flex min-h-0 flex-1 flex-col rounded-t-2xl bg-white shadow-[0_-4px_12px_rgb(0_0_0/0.08)]">
        <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-neutral-300" aria-hidden />
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2">
          <div className="flex items-baseline justify-between">
            <h1 className="text-xl font-bold">{mins(it.durationSecs)} min</h1>
            <span className="text-sm text-ink-muted">
              {hhmm(it.start)} – {hhmm(it.end)}
            </span>
          </div>
          {departed && (
            <p role="status" className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              This journey has already left ({hhmm(firstDeparture!)}).{" "}
              <button
                className="font-semibold underline"
                onClick={() => {
                  void usePlanStore.getState().plan();
                  navigate("/plan");
                }}
              >
                Get fresh routes
              </button>
            </p>
          )}
          <div className="mt-1">
            <LegChips it={it} />
          </div>
          <ol className="mt-4 space-y-3">
            {legs.map(({ leg }, i) => {
              const status = liveStatus(leg);
              const tracked = isTransit(leg) && myBuses.some((v) => v.tripId === ntaTrip(leg));
              const routeLive = isTransit(leg) && leg.route && liveRoutes.has(leg.route);
              return (
                <li key={i} className="flex gap-3">
                  <span className="mt-1 w-1.5 shrink-0 rounded-full" style={{ background: modeColor(leg) }} aria-hidden />
                  {isTransit(leg) ? (
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="font-bold">
                        <span className="mr-1.5 rounded-md px-1.5 py-0.5 text-xs text-white" style={{ background: modeColor(leg) }}>
                          {modeLabel(leg)} {leg.route && leg.route !== "DART" ? leg.route : ""}
                        </span>
                        {leg.headsign && <>to {leg.headsign}</>}
                      </p>
                      <p className="mt-1">
                        <b>{hhmm(leg.from.time)}</b> from {placeName(leg.from.name, "start")}{" "}
                        {status ? (
                          <span className={`font-semibold ${status.late ? "text-amber-700" : "text-brand"}`}>● Live · {status.text}</span>
                        ) : (
                          <span className="text-ink-muted">Scheduled</span>
                        )}
                      </p>
                      <p className="text-ink-muted">
                        {leg.stops.length + 1} stop{leg.stops.length ? "s" : ""} · {mins(leg.durationSecs)} min
                      </p>
                      <p>
                        <b>{hhmm(leg.to.time)}</b> arrive {leg.to.name}
                      </p>
                      {tracked && (
                        <p className="mt-1 text-xs font-semibold text-brand">
                          {rt.mode === "LIVE" ? "Your bus is on the map (live position)" : "Your bus is on the map (RECORDED data)"}
                        </p>
                      )}
                      {routeLive && !tracked && (
                        <p className="mt-1 text-xs text-ink-muted">
                          {rt.mode === "LIVE" ? "Live" : "Recorded"} {leg.route} buses shown on the map
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="flex-1 text-sm text-ink-muted">
                      Walk {mins(leg.durationSecs)} min{leg.distanceM ? ` (${Math.round(leg.distanceM)} m)` : ""} to {placeName(leg.to.name, "your destination")}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="mt-4 text-[11px] text-ink-muted">
            Times: Transitous with TFI real-time where available. Live positions: NTA, Dublin Bus and Go-Ahead Ireland routes.
          </p>
        </div>
      </div>
    </div>
  );
}
