import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiClient, isApiError } from "../../lib/api";
import type { ApiError } from "../../lib/api-types";
import { useGlanceAuth } from "../../lib/auth";
import { browser } from "wxt/browser";

export function useApi(): ApiClient {
  const auth = useGlanceAuth();
  return useMemo(() => new ApiClient(auth.getTokens), [auth.getTokens]);
}

export interface Query<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  refetch: () => Promise<void>;
}

/** Tiny fetch hook: loading/empty/error/success states per the frontend rules. */
export function useQuery<T extends { ok: true }>(fn: (api: ApiClient) => Promise<T | ApiError>, deps: unknown[] = [], opts: { enabled?: boolean; pollMs?: number } = {}): Query<T> {
  const api = useApi();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const run = useCallback(async () => {
    if (opts.enabled === false) return;
    const res = await fn(api);
    if (!alive.current) return;
    if (isApiError(res)) {
      setError(res);
    } else {
      setError(null);
      setData(res);
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, opts.enabled, ...deps]);
  useEffect(() => {
    alive.current = true;
    setLoading(true);
    void run();
    const id = opts.pollMs ? window.setInterval(() => void run(), opts.pollMs) : undefined;
    return () => {
      alive.current = false;
      if (id) window.clearInterval(id);
    };
  }, [run, opts.pollMs]);
  return { data, error, loading, refetch: run };
}

export function useStorageValue<T>(key: string, fallback: T): [T, (v: T) => Promise<void>] {
  const [v, setV] = useState<T>(fallback);
  useEffect(() => {
    void browser.storage.local.get(key).then((r) => {
      const val = (r as Record<string, T | undefined>)[key];
      if (val !== undefined) setV(val);
    });
    const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === "local" && key in changes) setV((changes[key]!.newValue as T) ?? fallback);
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, [key]);
  const set = useCallback(async (nv: T) => {
    setV(nv);
    await browser.storage.local.set({ [key]: nv });
  }, [key]);
  return [v, set];
}

export type ToastKind = "ok" | "warn" | "wait" | "err";

export function useToast() {
  const [toast, setToast] = useState<{ text: string; kind: ToastKind } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((text: string, kind: ToastKind = "ok") => {
    window.clearTimeout(timer.current);
    setToast({ text, kind });
    timer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);
  return { toast, show };
}
