import { useCallback, useEffect, useMemo, useState } from "react";
import { CONFIG } from "../../lib/config";
import { hasDemoFlag } from "../../lib/demoFlags";
import type { RealtimeRes } from "./types";

export type DataMode = "LIVE" | "RECORDED";
export const FALLBACK_TOAST = "Live data unavailable. Switched to RECORDED.";
export const LIVE_RETRY_MS = 60_000;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(CONFIG.apiTimeoutMs + 2000) });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Tech Spec 7.4 data modes. LIVE polls the BFF every 20 s; any 503/network error (at entry or later)
 * switches to the RECORDED loop with a toast, then LIVE is retried every 60 s and restored silently.
 * `?liveFail=1` forces the LIVE call to fail (demo flag).
 */
export function useRealtime(routes: readonly string[]) {
  const routesParam = [...new Set(routes)].sort().join(",");
  const liveFail = useMemo(
    () => hasDemoFlag("liveFail") || new URLSearchParams(window.location.search).get("liveFail") === "1",
    [],
  );
  const [mode, setMode] = useState<DataMode>("LIVE");
  const [data, setData] = useState<RealtimeRes | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pinnedRecorded, setPinnedRecorded] = useState(false);
  const [restart, setRestart] = useState(0);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: DataMode = "LIVE";
    let lastLiveTry = 0;
    let files: string[] | null = null;
    let recIdx = 0;

    const tryLive = async (): Promise<RealtimeRes | null> => {
      if (liveFail) return null;
      try {
        return await fetchJson<RealtimeRes>(`/api/realtime?routes=${encodeURIComponent(routesParam)}`);
      } catch {
        return null;
      }
    };

    const nextRecorded = async (): Promise<RealtimeRes | null> => {
      try {
        files ??= (await fetchJson<{ files: string[] }>("/recorded/index.json")).files;
        if (!files.length) return null;
        const snap = await fetchJson<RealtimeRes>(`/recorded/${files[recIdx % files.length]}`);
        recIdx += 1;
        return { ...snap, source: "RECORDED" };
      } catch {
        return null;
      }
    };

    const tick = async () => {
      if (!routesParam) return;
      const shouldTryLive = !pinnedRecorded && (current === "LIVE" || Date.now() - lastLiveTry >= LIVE_RETRY_MS);
      if (shouldTryLive) {
        lastLiveTry = Date.now();
        const live = await tryLive();
        if (!alive) return;
        if (live) {
          current = "LIVE";
          setMode("LIVE");
          setData(live);
          timer = setTimeout(tick, CONFIG.realtimePollMs);
          return;
        }
        if (current === "LIVE") setToast(FALLBACK_TOAST);
      }
      current = "RECORDED";
      setMode("RECORDED");
      const rec = await nextRecorded();
      if (!alive) return;
      if (rec) setData(rec);
      timer = setTimeout(tick, CONFIG.realtimePollMs);
    };

    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [liveFail, pinnedRecorded, restart, routesParam]);

  /** Badge tap: LIVE → RECORDED (pinned); RECORDED → try LIVE now. */
  const toggle = useCallback(() => {
    setToast(null);
    if (mode === "LIVE") setPinnedRecorded(true);
    else {
      setPinnedRecorded(false);
      setRestart((n) => n + 1);
    }
  }, [mode]);

  const dismissToast = useCallback(() => setToast(null), []);

  return { mode, data, toast, toggle, dismissToast };
}

export type Realtime = ReturnType<typeof useRealtime>;
