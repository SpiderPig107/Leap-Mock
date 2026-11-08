import { useEffect, useState } from "react";
import type { RouteData, RouteSummary } from "./types";

const cache = new Map<string, Promise<RouteData>>();

export function loadRoute(route: string): Promise<RouteData> {
  let p = cache.get(route);
  if (!p) {
    p = fetch(`/gtfs/${encodeURIComponent(route)}.json`).then((r) => {
      if (!r.ok) throw new Error(`gtfs ${route} ${r.status}`);
      return r.json() as Promise<RouteData>;
    });
    p.catch(() => cache.delete(route));
    cache.set(route, p);
  }
  return p;
}

export type RouteState = { status: "loading" } | { status: "error" } | { status: "ok"; data: RouteData };

export function useRouteData(route: string): RouteState {
  const [state, setState] = useState<{ route: string; s: RouteState }>({ route, s: { status: "loading" } });
  useEffect(() => {
    let alive = true;
    loadRoute(route).then(
      (data) => alive && setState({ route, s: { status: "ok", data } }),
      () => alive && setState({ route, s: { status: "error" } }),
    );
    return () => {
      alive = false;
    };
  }, [route]);
  return state.route === route ? state.s : { status: "loading" };
}

let indexPromise: Promise<RouteSummary[]> | null = null;

/** Every route the app has data for (Dublin Bus and Go-Ahead Dublin), for search and validation. */
export function loadRouteIndex(): Promise<RouteSummary[]> {
  indexPromise ??= fetch("/gtfs/index.json").then((r) => {
    if (!r.ok) throw new Error(`gtfs index ${r.status}`);
    return r.json() as Promise<RouteSummary[]>;
  });
  indexPromise.catch(() => (indexPromise = null));
  return indexPromise;
}

export function useRouteIndex(): RouteSummary[] | null {
  const [index, setIndex] = useState<RouteSummary[] | null>(null);
  useEffect(() => {
    let alive = true;
    loadRouteIndex().then(
      (i) => alive && setIndex(i),
      () => alive && setIndex([]),
    );
    return () => {
      alive = false;
    };
  }, []);
  return index;
}
