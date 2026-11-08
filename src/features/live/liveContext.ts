import { useOutletContext, useSearchParams } from "react-router-dom";
import { CONFIG } from "../../lib/config";
import type { RouteState } from "./gtfs";
import { useRouteStore } from "./routeStore";
import type { Realtime } from "./useRealtime";

export type LiveContext = { route: string; dirIdx: number; routeState: RouteState; rt: Realtime };

const ROUTE_RE = /^[A-Z0-9]{1,6}$/;

export const useLiveContext = () => useOutletContext<LiveContext>();

export function useLiveParams() {
  const [params] = useSearchParams();
  const saved = useRouteStore((s) => s.saved);
  const raw = (params.get("route") ?? "").toUpperCase();
  const route = ROUTE_RE.test(raw) ? raw : (saved[0] ?? CONFIG.defaultRoutes[0]);
  const dirIdx = params.get("dir") === "1" ? 1 : 0;
  return { route, dirIdx };
}

export const liveSearch = (route: string, dirIdx: number) => `?route=${encodeURIComponent(route)}&dir=${dirIdx}`;
