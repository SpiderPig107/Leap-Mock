import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALLOWED_ROUTES, GET, MAX_ROUTES, STALE_OK_MS, retryAfterSecs, UPSTREAM_TIMEOUT_MS, clearRealtimeCache, parseRoutes } from "../realtime";

const vehiclesFeed = {
  header: { timestamp: "1794060000" },
  entity: [
    {
      id: "V1",
      vehicle: {
        trip: { trip_id: "6016_1", route_id: "1 E1 a", start_date: "20261107" },
        position: { latitude: 53.35, longitude: -6.26, bearing: 90 },
        vehicle: { id: "bus-1" },
        timestamp: "1794059990",
      },
    },
    {
      id: "V2",
      vehicle: {
        trip: { trip_id: "6016_2", route_id: "1 16 c a" },
        position: { latitude: 53.3, longitude: -6.2 },
        vehicle: { id: "bus-2" },
      },
    },
    { id: "V3", vehicle: { trip: { trip_id: "x", route_id: "1 46A c a" }, position: { latitude: 1, longitude: 1 } } },
  ],
};
const tripsFeed = {
  entity: [
    {
      id: "T1",
      trip_update: {
        trip: { trip_id: "6016_1", route_id: "1 E1 a" },
        stop_time_update: [{ stop_sequence: 5 }, { stop_sequence: 6, arrival: { delay: 180 } }],
      },
    },
    { id: "T2", trip_update: { trip: { trip_id: "x", route_id: "1 46A c a" }, stop_time_update: [{ arrival: { delay: 1 } }] } },
  ],
};

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const req = (qs = "?routes=16,39A,E1") => new Request(`https://leap.test/api/realtime${qs}`);

function mockUpstream(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init));
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  clearRealtimeCache();
  vi.stubEnv("NTA_KEY", "test-key");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("parseRoutes (F7 allowlist)", () => {
  it("rejects a missing or empty list", () => {
    expect(parseRoutes(null)).toBeNull();
    expect(parseRoutes(" ")).toBeNull();
  });
  it("accepts any Dublin Bus or Go-Ahead Dublin route", () => expect(parseRoutes("s4,c1,E1,220")).toEqual(["220", "C1", "E1", "S4"]));
  it("rejects more than MAX_ROUTES routes", () => expect(parseRoutes(ALLOWED_ROUTES.slice(0, MAX_ROUTES + 1).join(","))).toBeNull());
  it("sorts and dedupes", () => expect(parseRoutes("e1,16,E1")).toEqual(["16", "E1"]));
  it("rejects unknown routes", () => expect(parseRoutes("E1,99X")).toBeNull());
  it("accepts repeated valid routes", () => expect(parseRoutes("E1,E1,E1,16")).toEqual(["16", "E1"]));
});

describe("GET /api/realtime", () => {
  it("returns filtered vehicles and trip delays with a shared cache header", async () => {
    const fetchFn = mockUpstream(async (url) => ok(url.includes("Vehicles") ? vehiclesFeed : tripsFeed));
    const res = await GET(req("?routes=16,39A,E1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=60");
    const body = await res.json();
    expect(body.source).toBe("LIVE");
    expect(body.vehicles).toEqual([
      { vehicleId: "bus-1", route: "E1", tripId: "6016_1", lat: 53.35, lon: -6.26, bearing: 90, ts: 1794059990 },
      { vehicleId: "bus-2", route: "16", tripId: "6016_2", lat: 53.3, lon: -6.2, ts: 1794060000 },
    ]);
    expect(body.tripDelays).toEqual({ "6016_1": { delaySecs: 180, stopSeq: 6 } });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const init = fetchFn.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("test-key");
    expect(JSON.stringify(body)).not.toContain("test-key");
  });

  it("filters to the requested routes only", async () => {
    mockUpstream(async (url) => ok(url.includes("Vehicles") ? vehiclesFeed : tripsFeed));
    const body = await (await GET(req("?routes=16"))).json();
    expect(body.vehicles.map((v: { route: string }) => v.route)).toEqual(["16"]);
    expect(body.tripDelays).toEqual({});
  });

  it("serves query-string variants from one cached upstream fetch", async () => {
    const fetchFn = mockUpstream(async (url) => ok(url.includes("Vehicles") ? vehiclesFeed : tripsFeed));
    for (const qs of ["?routes=16", "?routes=16&x=1", "?routes=16&x=2"]) {
      expect((await GET(req(qs))).status).toBe(200);
    }
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight upstream fetch across parallel variants", async () => {
    const fetchFn = mockUpstream(async (url) => ok(url.includes("Vehicles") ? vehiclesFeed : tripsFeed));
    const res = await Promise.all(["?routes=16&a=1", "?routes=16&a=2", "?routes=16&a=3"].map((q) => GET(req(q))));
    expect(res.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("accepts route lists in any order or case", async () => {
    mockUpstream(async (url) => ok(url.includes("Vehicles") ? vehiclesFeed : tripsFeed));
    for (const qs of ["?routes=E1,16", "?routes=e1,16,E1", "?routes=16%2CE1"]) {
      expect((await GET(req(qs))).status).toBe(200);
    }
  });

  it("400 on a non-allowlisted route, without calling upstream", async () => {
    const fetchFn = mockUpstream(async () => ok({}));
    const res = await GET(req("?routes=99X"));
    expect(res.status).toBe(400);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("503 fallback when the key is missing", async () => {
    vi.stubEnv("NTA_KEY", "");
    const fetchFn = mockUpstream(async () => ok({}));
    const res = await GET(req("?routes=16,39A,E1"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ fallback: true });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("503 fallback on upstream error, without echoing the upstream body", async () => {
    mockUpstream(async () => new Response("secret upstream detail", { status: 401 }));
    const res = await GET(req("?routes=16,39A,E1"));
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toBe('{"fallback":true}');
  });

  it("still serves vehicles when only TripUpdates fails", async () => {
    mockUpstream(async (url) => (url.includes("Vehicles") ? ok(vehiclesFeed) : new Response("", { status: 500 })));
    const res = await GET(req("?routes=16,39A,E1"));
    expect(res.status).toBe(200);
    expect((await res.json()).tripDelays).toEqual({});
  });

  it("503 fallback on upstream timeout", async () => {
    vi.useFakeTimers();
    mockUpstream(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const pending = GET(req("?routes=16,39A,E1"));
    await vi.advanceTimersByTimeAsync(UPSTREAM_TIMEOUT_MS + 10);
    const res = await pending;
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ fallback: true });
  });
});

describe("NTA rate limit (429)", () => {
  const limited = () => new Response('{"statusCode":429}', { status: 429, headers: { "Retry-After": "27" } });

  it("serves the last good LIVE data and backs off until Retry-After", async () => {
    vi.useFakeTimers();
    let rateLimited = false;
    const fetchFn = mockUpstream(async (url) =>
      rateLimited ? limited() : ok(url.includes("Vehicles") ? vehiclesFeed : tripsFeed),
    );
    expect((await GET(req())).status).toBe(200);
    rateLimited = true;
    await vi.advanceTimersByTimeAsync(61_000);
    const res = await GET(req("?routes=E1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=15");
    const body = await res.json();
    expect(body.source).toBe("LIVE");
    expect(body.vehicles.map((v: { route: string }) => v.route)).toEqual(["E1"]);
    expect(body.tripDelays).toEqual({ "6016_1": { delaySecs: 180, stopSeq: 6 } });
    const calls = fetchFn.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect((await GET(req())).status).toBe(200);
    expect(fetchFn.mock.calls.length).toBe(calls);
  });

  it("falls back to 503 once the last good data is too old", async () => {
    vi.useFakeTimers();
    let rateLimited = false;
    mockUpstream(async (url) => (rateLimited ? limited() : ok(url.includes("Vehicles") ? vehiclesFeed : tripsFeed)));
    expect((await GET(req())).status).toBe(200);
    rateLimited = true;
    await vi.advanceTimersByTimeAsync(STALE_OK_MS + 1000);
    expect((await GET(req())).status).toBe(503);
  });
});

describe("retryAfterSecs", () => {
  it("parses delta-seconds", () => expect(retryAfterSecs("27")).toBe(27));
  it("parses an HTTP-date", () => {
    const at = new Date(Date.now() + 90_000).toUTCString();
    expect(retryAfterSecs(at)).toBeGreaterThanOrEqual(89);
  });
  it("treats a past HTTP-date as retry now", () => expect(retryAfterSecs(new Date(Date.now() - 5000).toUTCString())).toBe(0));
  it("defaults to 30 s", () => {
    expect(retryAfterSecs(null)).toBe(30);
    expect(retryAfterSecs("soon")).toBe(30);
  });
});

describe("TripUpdates outage", () => {
  it("drops carried-over delays once they are older than the stale window", async () => {
    vi.useFakeTimers();
    let tripsDown = false;
    mockUpstream(async (url) =>
      url.includes("Vehicles") ? ok(vehiclesFeed) : tripsDown ? new Response("", { status: 500 }) : ok(tripsFeed),
    );
    expect(Object.keys((await (await GET(req())).json()).tripDelays)).toEqual(["6016_1"]);
    tripsDown = true;
    await vi.advanceTimersByTimeAsync(61_000);
    expect(Object.keys((await (await GET(req())).json()).tripDelays)).toEqual(["6016_1"]);
    await vi.advanceTimersByTimeAsync(STALE_OK_MS);
    expect((await (await GET(req())).json()).tripDelays).toEqual({});
  });
});

describe("route lookup", () => {
  it("has a route id for every route in public/gtfs/index.json", () => {
    const index = JSON.parse(readFileSync(new URL("../../public/gtfs/index.json", import.meta.url), "utf8")) as { route: string }[];
    expect([...ALLOWED_ROUTES].sort()).toEqual(index.map((r) => r.route).sort());
    expect(index.length).toBeGreaterThan(100);
    for (const r of ["E1", "39A", "16", "S4", "220"]) expect(ALLOWED_ROUTES).toContain(r);
  });
  it("leaves out commuter routes mostly outside Dublin", () => expect(ALLOWED_ROUTES).not.toContain("126"));
});
