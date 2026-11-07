import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, ROUTE_IDS, UPSTREAM_TIMEOUT_MS, clearRealtimeCache, parseRoutes } from "../realtime";

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
const req = (qs = "") => new Request(`https://leap.test/api/realtime${qs}`);

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
  it("defaults to all routes, sorted", () => expect(parseRoutes(null)).toEqual(["16", "39A", "E1"]));
  it("sorts and dedupes", () => expect(parseRoutes("e1,16,E1")).toEqual(["16", "E1"]));
  it("rejects unknown routes", () => expect(parseRoutes("E1,99X")).toBeNull());
  it("accepts repeated valid routes", () => expect(parseRoutes("E1,E1,E1,16")).toEqual(["16", "E1"]));
});

describe("GET /api/realtime", () => {
  it("returns filtered vehicles and trip delays with a shared cache header", async () => {
    const fetchFn = mockUpstream(async (url) => ok(url.includes("Vehicles") ? vehiclesFeed : tripsFeed));
    const res = await GET(req("?routes=16,39A,E1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=20");
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

describe("route lookup", () => {
  it("matches public/gtfs/routes.json from the extract script", () => {
    const fromScript = JSON.parse(readFileSync(new URL("../../public/gtfs/routes.json", import.meta.url), "utf8"));
    expect(ROUTE_IDS).toEqual(fromScript);
  });
});
