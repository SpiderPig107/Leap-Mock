/// <reference types="node" />
// GET /api/realtime?routes=E1,39A,16 — NTA GTFS-R proxy for any Dublin Bus / Go-Ahead Dublin route (Tech Spec 7.2, Security Review F6/F7/F10).
import { ROUTE_IDS } from "./_lib/routeIds.js";

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

export { ROUTE_IDS };
export const ALLOWED_ROUTES = Object.values(ROUTE_IDS);
const ALLOWED = new Set(ALLOWED_ROUTES);
/** Most routes one request may ask for (the app sends the user's saved routes). */
export const MAX_ROUTES = 20;

const NTA_BASE = "https://api.nationaltransport.ie/gtfsr/v2";
export const UPSTREAM_TIMEOUT_MS = 8000;
// NTA allows roughly 1 call per feed per minute per key; the CDN must absorb all client polling.
const CACHE_OK = "public, s-maxage=60, stale-while-revalidate=300";
const CACHE_STALE = "public, s-maxage=15";
/** On NTA failure (e.g. 429 rate limit) keep serving the last good LIVE data this long. */
export const STALE_OK_MS = 300_000;

/** Returns the sorted, deduped route list, or null if empty, too long or any value is not allowlisted. */
export function parseRoutes(raw: string | null): string[] | null {
  if (raw === null || raw.trim() === "") return null;
  const parts = raw.split(",").map((s) => s.trim().toUpperCase());
  if (parts.length > MAX_ROUTES || parts.some((p) => !ALLOWED.has(p))) return null;
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

export function mapVehicles(feed: Feed, routes: ReadonlySet<string> = ALLOWED): RealtimeVehicle[] {
  const out: RealtimeVehicle[] = [];
  for (const e of feed.entity ?? []) {
    const v = e.vehicle;
    const route = ROUTE_IDS[v?.trip?.route_id ?? ""];
    const lat = v?.position?.latitude;
    const lon = v?.position?.longitude;
    if (!v || !route || !routes.has(route) || typeof lat !== "number" || typeof lon !== "number") continue;
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

/** Latest known delay per trip, grouped by route short name, in one pass over the feed. */
export function mapTripDelays(feed: Feed): Record<string, RealtimeRes["tripDelays"]> {
  const out: Record<string, RealtimeRes["tripDelays"]> = {};
  for (const e of feed.entity ?? []) {
    const tu = e.trip_update;
    const route = ROUTE_IDS[tu?.trip?.route_id ?? ""];
    const tripId = tu?.trip?.trip_id;
    if (!tu || !route || !tripId) continue;
    if (tu.trip?.schedule_relationship === "CANCELED") continue;
    const stu = (tu.stop_time_update ?? []).find(
      (s) => typeof s.arrival?.delay === "number" || typeof s.departure?.delay === "number",
    );
    if (!stu) continue;
    const delaySecs = (stu.arrival?.delay ?? stu.departure?.delay) as number;
    (out[route] ??= {})[tripId] = { delaySecs, ...(typeof stu.stop_sequence === "number" ? { stopSeq: stu.stop_sequence } : {}) };
  }
  return out;
}

/** Retry-After as seconds (delta-seconds or HTTP-date); 30 s if missing or invalid. */
export function retryAfterSecs(raw: string | null): number {
  const n = Number(raw);
  if (raw && raw.trim() !== "" && Number.isFinite(n) && n >= 0) return n;
  const at = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - Date.now()) / 1000)) : 30;
}

class RateLimited extends Error {
  name = "RateLimited";
  constructor(readonly retryAfterSecs: number) {
    super("NTA rate limited");
  }
}

async function fetchFeed(path: string, key: string, signal: AbortSignal): Promise<Feed> {
  const res = await fetch(`${NTA_BASE}/${path}?format=json`, {
    headers: { "x-api-key": key, Accept: "application/json" },
    signal,
  });
  if (res.status === 429) throw new RateLimited(retryAfterSecs(res.headers.get("Retry-After")));
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

// One upstream load per instance for all routes (incl. in-flight), filtered per request, so query variants
// cannot multiply NTA calls. NTA rate-limits keys (429 + Retry-After), so we back off and serve last good data.
const CACHE_TTL_MS = 60_000;
type Snapshot = {
  fetchedAt: string;
  delaysAt: string;
  vehicles: RealtimeVehicle[];
  delaysByRoute: Record<string, RealtimeRes["tripDelays"]>;
};
let memo: { at: number; p: Promise<Snapshot> } | null = null;
let lastGood: Snapshot | null = null;
let backoffUntil = 0;
export const clearRealtimeCache = () => {
  memo = null;
  lastGood = null;
  backoffUntil = 0;
};

async function load(key: string): Promise<Snapshot> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    // Vehicles is required; TripUpdates is best-effort (ETAs degrade to "Scheduled").
    const [vehicles, trips] = await Promise.allSettled([
      fetchFeed("Vehicles", key, ctrl.signal),
      fetchFeed("TripUpdates", key, ctrl.signal),
    ]);
    for (const r of [vehicles, trips]) {
      if (r.status === "rejected" && r.reason instanceof RateLimited) {
        backoffUntil = Math.max(backoffUntil, Date.now() + r.reason.retryAfterSecs * 1000);
      }
    }
    if (vehicles.status === "rejected") throw vehicles.reason;
    const now = new Date().toISOString();
    const keepDelays = lastGood && Date.now() - Date.parse(lastGood.delaysAt) < STALE_OK_MS;
    const res: Snapshot = {
      fetchedAt: now,
      ...(trips.status === "fulfilled"
        ? { delaysAt: now, delaysByRoute: mapTripDelays(trips.value) }
        : keepDelays
          ? { delaysAt: lastGood!.delaysAt, delaysByRoute: lastGood!.delaysByRoute }
          : { delaysAt: now, delaysByRoute: {} }),
      vehicles: mapVehicles(vehicles.value),
    };
    lastGood = res;
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function forRoutes(snap: Snapshot, routes: string[]): RealtimeRes {
  const wanted = new Set(routes);
  return {
    source: "LIVE",
    fetchedAt: snap.fetchedAt,
    vehicles: snap.vehicles.filter((v) => wanted.has(v.route)),
    tripDelays: Object.assign({}, ...routes.map((r) => snap.delaysByRoute[r] ?? {})),
  };
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const routes = parseRoutes(url.searchParams.get("routes"));
  if (!routes) return json(400, { error: "INVALID_ROUTE" }, "no-store");
  const key = process.env.NTA_KEY;
  if (!key) return fallback();
  const now = Date.now();
  const staleOk = () => (lastGood && now - Date.parse(lastGood.fetchedAt) < STALE_OK_MS ? lastGood : null);
  if ((!memo || now - memo.at >= CACHE_TTL_MS) && now < backoffUntil) {
    const stale = staleOk();
    return stale ? json(200, forRoutes(stale, routes), CACHE_STALE) : fallback();
  }
  if (!memo || now - memo.at >= CACHE_TTL_MS) {
    const fresh = { at: now, p: load(key) };
    memo = fresh;
    fresh.p.catch(() => memo === fresh && (memo = null));
  }
  try {
    return json(200, forRoutes(await memo.p, routes), CACHE_OK);
  } catch (err) {
    // F10: generic body to the client; F6: never log headers or the key.
    const reqId = Math.random().toString(36).slice(2, 10);
    console.error(`[realtime ${reqId}] upstream failure: ${err instanceof Error ? err.name : "unknown"}`);
    const stale = staleOk();
    return stale ? json(200, forRoutes(stale, routes), CACHE_STALE) : fallback();
  }
}
