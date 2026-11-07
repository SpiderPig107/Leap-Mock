/// <reference types="node" />
// GET /api/realtime?routes=E1,39A,16 — NTA GTFS-R proxy (Tech Spec 7.2, Security Review F6/F7/F10).
// Self-contained on purpose: Vercel ESM functions are fragile with relative TS imports.

export type RealtimeVehicle = {
  vehicleId: string;
  route: string;
  tripId: string;
  lat: number;
  lon: number;
  bearing?: number;
  ts: number;
};

export type RealtimeRes = {
  source: "LIVE" | "RECORDED";
  fetchedAt: string;
  vehicles: RealtimeVehicle[];
  tripDelays: Record<string, { delaySecs: number; stopSeq?: number }>;
};

/** GTFS route_id → short name. Must match public/gtfs/routes.json (checked by a unit test). */
export const ROUTE_IDS: Record<string, string> = {
  "1 E1 a": "E1",
  "1 39A c a": "39A",
  "1 16 c a": "16",
};
export const ALLOWED_ROUTES = Object.values(ROUTE_IDS);

const NTA_BASE = "https://api.nationaltransport.ie/gtfsr/v2";
export const UPSTREAM_TIMEOUT_MS = 8000;
const CACHE_OK = "public, s-maxage=20, stale-while-revalidate=40";

/** Returns the sorted, deduped route list, or null if any value is not allowlisted. Empty → all routes. */
export function parseRoutes(raw: string | null): string[] | null {
  if (raw === null || raw.trim() === "") return [...ALLOWED_ROUTES].sort();
  const parts = raw.split(",").map((s) => s.trim().toUpperCase());
  if (parts.length > 10 || parts.some((p) => !ALLOWED_ROUTES.includes(p))) return null;
  return [...new Set(parts)].sort();
}

type FeedEntity = {
  vehicle?: {
    trip?: { trip_id?: string; route_id?: string };
    position?: { latitude?: number; longitude?: number; bearing?: number };
    vehicle?: { id?: string };
    timestamp?: string | number;
  };
  trip_update?: {
    trip?: { trip_id?: string; route_id?: string; schedule_relationship?: string };
    stop_time_update?: {
      stop_sequence?: number;
      arrival?: { delay?: number };
      departure?: { delay?: number };
    }[];
  };
};
type Feed = { header?: { timestamp?: string | number }; entity?: FeedEntity[] };

export function mapVehicles(feed: Feed, routes: string[]): RealtimeVehicle[] {
  const out: RealtimeVehicle[] = [];
  for (const e of feed.entity ?? []) {
    const v = e.vehicle;
    const route = ROUTE_IDS[v?.trip?.route_id ?? ""];
    const lat = v?.position?.latitude;
    const lon = v?.position?.longitude;
    if (!v || !route || !routes.includes(route) || typeof lat !== "number" || typeof lon !== "number") continue;
    out.push({
      vehicleId: String(v.vehicle?.id ?? v.trip?.trip_id ?? "unknown"),
      route,
      tripId: String(v.trip?.trip_id ?? ""),
      lat,
      lon,
      ...(typeof v.position?.bearing === "number" ? { bearing: v.position.bearing } : {}),
      ts: Number(v.timestamp ?? feed.header?.timestamp ?? 0),
    });
  }
  return out;
}

export function mapTripDelays(feed: Feed, routes: string[]): RealtimeRes["tripDelays"] {
  const out: RealtimeRes["tripDelays"] = {};
  for (const e of feed.entity ?? []) {
    const tu = e.trip_update;
    const route = ROUTE_IDS[tu?.trip?.route_id ?? ""];
    const tripId = tu?.trip?.trip_id;
    if (!tu || !route || !tripId || !routes.includes(route)) continue;
    if (tu.trip?.schedule_relationship === "CANCELED") continue;
    const stu = (tu.stop_time_update ?? []).find(
      (s) => typeof s.arrival?.delay === "number" || typeof s.departure?.delay === "number",
    );
    if (!stu) continue;
    const delaySecs = (stu.arrival?.delay ?? stu.departure?.delay) as number;
    out[tripId] = { delaySecs, ...(typeof stu.stop_sequence === "number" ? { stopSeq: stu.stop_sequence } : {}) };
  }
  return out;
}

async function fetchFeed(path: string, key: string, signal: AbortSignal): Promise<Feed> {
  const res = await fetch(`${NTA_BASE}/${path}?format=json`, {
    headers: { "x-api-key": key, Accept: "application/json" },
    signal,
  });
  if (!res.ok) throw new Error(`upstream ${path} ${res.status}`);
  return (await res.json()) as Feed;
}

function json(status: number, body: unknown, cache: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cache },
  });
}

const fallback = () => json(503, { fallback: true }, "no-store");

// Per-instance cache so query-string variants cannot bypass the CDN and burn NTA quota.
const CACHE_TTL_MS = 20_000;
const memo = new Map<string, { at: number; body: RealtimeRes }>();
export const clearRealtimeCache = () => memo.clear();

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const routes = parseRoutes(url.searchParams.get("routes"));
  if (!routes) return json(400, { error: "INVALID_ROUTE" }, "no-store");
  const key = process.env.NTA_KEY;
  if (!key) return fallback();
  const cacheKey = routes.join(",");
  const hit = memo.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return json(200, hit.body, CACHE_OK);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    // Vehicles is required; TripUpdates is best-effort (ETAs degrade to "Scheduled").
    const [vehicles, trips] = await Promise.allSettled([
      fetchFeed("Vehicles", key, ctrl.signal),
      fetchFeed("TripUpdates", key, ctrl.signal),
    ]);
    if (vehicles.status === "rejected") throw vehicles.reason;
    const body: RealtimeRes = {
      source: "LIVE",
      fetchedAt: new Date().toISOString(),
      vehicles: mapVehicles(vehicles.value, routes),
      tripDelays: trips.status === "fulfilled" ? mapTripDelays(trips.value, routes) : {},
    };
    memo.set(cacheKey, { at: Date.now(), body });
    return json(200, body, CACHE_OK);
  } catch (err) {
    // F10: generic body to the client; F6: never log headers or the key.
    const reqId = Math.random().toString(36).slice(2, 10);
    console.error(`[realtime ${reqId}] upstream failure: ${err instanceof Error ? err.name : "unknown"}`);
    return fallback();
  } finally {
    clearTimeout(timer);
  }
}
