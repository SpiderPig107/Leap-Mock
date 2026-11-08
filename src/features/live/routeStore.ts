import { create } from "zustand";
import { persist } from "zustand/middleware";
import { CONFIG } from "../../lib/config";

export const MAX_SAVED_ROUTES = 8;

type RouteStore = {
  /** The user's routes, shown as tabs on the Live map, in their order. */
  saved: string[];
  add: (route: string) => void;
  remove: (route: string) => void;
  /** Moves a route one place left (-1) or right (+1). */
  move: (route: string, by: -1 | 1) => void;
};

export const useRouteStore = create<RouteStore>()(
  persist(
    (set) => ({
      saved: [...CONFIG.defaultRoutes],
      add: (route) =>
        set((s) => (s.saved.includes(route) || s.saved.length >= MAX_SAVED_ROUTES ? s : { saved: [...s.saved, route] })),
      remove: (route) => set((s) => ({ saved: s.saved.filter((r) => r !== route) })),
      move: (route, by) =>
        set((s) => {
          const i = s.saved.indexOf(route);
          const j = i + by;
          if (i < 0 || j < 0 || j >= s.saved.length) return s;
          const saved = [...s.saved];
          [saved[i], saved[j]] = [saved[j], saved[i]];
          return { saved };
        }),
    }),
    { name: "leap-plus-routes", partialize: (s) => ({ saved: s.saved }) },
  ),
);
