import { ChevronLeft, ChevronRight, Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useRouteIndex } from "./gtfs";
import { MAX_SAVED_ROUTES, useRouteStore } from "./routeStore";

const operatorLabel = (op: string) => (op.includes("Go-Ahead") ? "Go-Ahead Ireland" : "Dublin Bus");

/** Full-screen sheet over the Live map: manage saved routes and search every Dublin route. */
export function RoutePicker({ onClose, onPick }: { onClose: () => void; onPick: (route: string) => void }) {
  const index = useRouteIndex();
  const { saved, add, remove, move } = useRouteStore();
  const [query, setQuery] = useState("");
  const full = saved.length >= MAX_SAVED_ROUTES;

  const results = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!index) return [];
    if (!q) return index;
    const byNumber = index.filter((r) => r.route.startsWith(q));
    const byName = index.filter((r) => !r.route.startsWith(q) && r.longName.toUpperCase().includes(q));
    return [...byNumber, ...byName];
  }, [index, query]);
  const nameOf = (route: string) => index?.find((r) => r.route === route)?.longName ?? "";

  return (
    <div className="absolute inset-0 z-[1100] flex flex-col bg-white" role="dialog" aria-modal="true" aria-label="Choose routes">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <h2 className="text-lg font-bold">Your routes</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="grid h-11 w-11 place-items-center rounded-full hover:bg-neutral-100">
          <X size={22} aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ul className="px-4 py-2">
          {saved.length === 0 && <li className="py-2 text-sm text-ink-muted">No routes saved yet. Add one below.</li>}
          {saved.map((r, i) => (
            <li key={r} className="flex items-center gap-2 py-1.5">
              <button
                type="button"
                onClick={() => onPick(r)}
                className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span className="min-w-[3rem] rounded-full bg-brand px-2.5 py-1 text-center text-sm font-bold text-white">{r}</span>
                <span className="truncate text-sm text-ink-muted">{nameOf(r)}</span>
              </button>
              <button type="button" onClick={() => move(r, -1)} disabled={i === 0} aria-label={`Move ${r} left`} className="grid h-11 w-9 place-items-center text-ink-muted disabled:opacity-30">
                <ChevronLeft size={20} aria-hidden />
              </button>
              <button type="button" onClick={() => move(r, 1)} disabled={i === saved.length - 1} aria-label={`Move ${r} right`} className="grid h-11 w-9 place-items-center text-ink-muted disabled:opacity-30">
                <ChevronRight size={20} aria-hidden />
              </button>
              <button type="button" onClick={() => remove(r)} aria-label={`Remove ${r}`} className="grid h-11 w-9 place-items-center text-ink-muted">
                <X size={20} aria-hidden />
              </button>
            </li>
          ))}
        </ul>

        <div className="sticky top-0 border-y border-neutral-200 bg-white px-4 py-3">
          <label className="flex items-center gap-2 rounded-full bg-neutral-100 px-4">
            <Search size={18} className="shrink-0 text-ink-muted" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search route number or place"
              aria-label="Search routes"
              className="min-h-[44px] w-full bg-transparent text-sm outline-none"
            />
          </label>
          {full && <p className="mt-2 text-xs text-ink-muted">You can save up to {MAX_SAVED_ROUTES} routes. Remove one to add another.</p>}
        </div>

        <ul className="px-4 pb-4">
          {!index && <li className="py-3 text-sm text-ink-muted">Loading routes…</li>}
          {index && results.length === 0 && <li className="py-3 text-sm text-ink-muted">No Dublin routes match "{query}".</li>}
          {results.map((r) => {
            const isSaved = saved.includes(r.route);
            return (
              <li key={r.route} className="flex items-center gap-3 py-1.5">
                <button type="button" onClick={() => onPick(r.route)} className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3 text-left">
                  <span className="min-w-[3rem] rounded-full border border-brand px-2.5 py-1 text-center text-sm font-bold text-brand-dark">{r.route}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{r.longName}</span>
                    <span className="block text-xs text-ink-muted">{operatorLabel(r.operator)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => add(r.route)}
                  disabled={isSaved || full}
                  aria-label={isSaved ? `${r.route} saved` : `Save ${r.route}`}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-brand-dark disabled:text-neutral-300"
                >
                  <Plus size={22} aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
