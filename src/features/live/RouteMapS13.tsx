import "leaflet/dist/leaflet.css";
import "./live.css";
import type { LatLngBoundsExpression } from "leaflet";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap } from "react-leaflet";
import { Link, Outlet, useMatch, useNavigate } from "react-router-dom";
import { CONFIG } from "../../lib/config";
import { BusMarker } from "./BusMarker";
import { formatDelay } from "./eta";
import { useRouteData } from "./gtfs";
import { LiveBadge } from "./LiveBadge";
import { liveSearch, useLiveParams, type LiveContext } from "./liveContext";
import { LiveToast } from "./LiveToast";
import { RoutePicker } from "./RoutePicker";
import { useRouteStore } from "./routeStore";
import type { Stop } from "./types";
import { useRealtime } from "./useRealtime";

const DUBLIN: [number, number] = [53.3498, -6.2603];

function FitView({ bounds, focus }: { bounds: LatLngBoundsExpression | null; focus: Stop | null }) {
  const map = useMap();
  useEffect(() => {
    if (focus) map.setView([focus.lat, focus.lon], 14, { animate: true });
    else if (bounds) map.fitBounds(bounds, { padding: [24, 24] });
  }, [map, bounds, focus]);
  return null;
}

/** S13 Live route map. Layout for S14 (stop list) and S15 (stop detail) in the sheet below the map. */
export function RouteMapS13() {
  const { route, dirIdx } = useLiveParams();
  const saved = useRouteStore((s) => s.saved);
  const tabs = useMemo(() => (saved.includes(route) ? saved : [...saved, route]), [saved, route]);
  const rt = useRealtime(tabs);
  const [picking, setPicking] = useState(false);
  const routeState = useRouteData(route);
  const navigate = useNavigate();
  const stopMatch = useMatch("/live/stop/:stopId");
  const direction = routeState.status === "ok" ? routeState.data.directions[dirIdx] ?? routeState.data.directions[0] : null;

  const bounds = useMemo<LatLngBoundsExpression | null>(
    () => (direction && direction.shape.length ? direction.shape : null),
    [direction],
  );
  const focus = useMemo(
    () => direction?.stops.find((s) => s.stopId === stopMatch?.params.stopId) ?? null,
    [direction, stopMatch?.params.stopId],
  );
  const vehicles = useMemo(() => rt.data?.vehicles.filter((v) => v.route === route) ?? [], [rt.data, route]);

  const ctx: LiveContext = { route, dirIdx, routeState, rt };

  return (
    <div className="flex h-full flex-col">
      <div className="relative h-[48%] min-h-[260px] shrink-0">
        <MapContainer center={DUBLIN} zoom={12} zoomControl={false} className="h-full w-full">
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            maxZoom={19}
          />
          <FitView bounds={bounds} focus={focus} />
          {direction && <Polyline positions={direction.shape} pathOptions={{ color: "#2E8A29", weight: 5, opacity: 0.8 }} />}
          {direction?.stops.map((s) => (
            <CircleMarker
              key={s.stopId}
              center={[s.lat, s.lon]}
              radius={s.stopId === focus?.stopId ? 8 : 4}
              pathOptions={{
                color: "#2E8A29",
                weight: 2,
                fillColor: s.stopId === focus?.stopId ? "#2E8A29" : "#fff",
                fillOpacity: 1,
              }}
              eventHandlers={{ click: () => navigate(`/live/stop/${encodeURIComponent(s.stopId)}${liveSearch(route, dirIdx)}`) }}
            />
          ))}
          {vehicles.map((v) => {
            const d = rt.data?.tripDelays[v.tripId];
            return <BusMarker key={v.vehicleId} vehicle={v} delayLabel={d ? formatDelay(d.delaySecs) : undefined} />;
          })}
        </MapContainer>

        <div className="pointer-events-none absolute inset-x-0 top-0 z-[1000] flex items-start justify-between gap-2 p-3">
          <div className="pointer-events-auto flex min-w-0 gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Route">
            {tabs.map((r) => (
              <Link
                key={r}
                to={`/live${liveSearch(r, 0)}`}
                role="tab"
                aria-selected={r === route}
                className={`min-h-[36px] shrink-0 rounded-full px-3.5 py-2 text-sm font-bold shadow-md ${
                  r === route ? "bg-brand text-white" : "bg-white text-ink"
                }`}
              >
                {r}
              </Link>
            ))}
            <button
              type="button"
              onClick={() => setPicking(true)}
              aria-label="Choose routes"
              className="grid min-h-[36px] w-9 shrink-0 place-items-center rounded-full bg-white text-brand-dark shadow-md"
            >
              <Plus size={20} aria-hidden />
            </button>
          </div>
          <div className="pointer-events-auto">
            <LiveBadge mode={rt.mode} fetchedAt={rt.data?.fetchedAt} onToggle={rt.toggle} />
          </div>
        </div>

        {(!rt.data || vehicles.length === 0) && (
          <div className="absolute inset-x-0 bottom-6 z-[1000] flex justify-center">
            <span className="rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold text-ink-muted shadow">
              {!rt.data
                ? "Loading buses…"
                : rt.mode === "RECORDED" && !(CONFIG.defaultRoutes as readonly string[]).includes(route)
                  ? `Recorded demo data only covers ${CONFIG.defaultRoutes.join(", ")}.`
                  : "No buses on this route right now."}
            </span>
          </div>
        )}
        <LiveToast message={rt.toast} onDismiss={rt.dismissToast} />
      </div>

      <div className="relative z-[1001] flex min-h-0 flex-1 flex-col rounded-t-2xl bg-white shadow-[0_-4px_12px_rgb(0_0_0/0.08)]">
        <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-neutral-300" aria-hidden />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Outlet context={ctx} />
        </div>
      </div>
      {picking && (
        <RoutePicker
          onClose={() => setPicking(false)}
          onPick={(r) => {
            setPicking(false);
            navigate(`/live${liveSearch(r, 0)}`);
          }}
        />
      )}
    </div>
  );
}
