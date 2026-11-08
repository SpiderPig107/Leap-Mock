export type RealtimeVehicle = {
  vehicleId: string;
  route: string;
  tripId: string;
  lat: number;
  lon: number;
  bearing?: number;
  ts: number;
};

/** Same shape as api/realtime.ts and public/recorded/snap-*.json. */
export type RealtimeRes = {
  source: "LIVE" | "RECORDED";
  fetchedAt: string;
  vehicles: RealtimeVehicle[];
  tripDelays: Record<string, { delaySecs: number; stopSeq?: number }>;
};

export type Stop = { stopId: string; code: string; name: string; lat: number; lon: number };
export type Trip = { tripId: string; startSecs: number; stopOffsetsSecs: number[] };
export type Direction = {
  directionId: number;
  headsign: string;
  shape: [number, number][];
  stops: Stop[];
  timetable: Trip[];
};
export type RouteData = {
  route: string;
  routeId: string;
  longName: string;
  operator: string;
  serviceDate: string;
  directions: Direction[];
};
export type RouteSummary = { route: string; longName: string; operator: string };
