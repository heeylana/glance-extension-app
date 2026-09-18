/**
 * Auth for the side panel without any wallet SDK in the extension.
 *
 * Phantom lives in web pages, not extension pages, so signing happens in the
 * Glance web console. The panel starts a "handoff": it asks the backend for a
 * one-time code, opens the console with it, and polls until the console (once
 * the user has signed the sign-in message with Phantom) completes it with a
 * session token. The token is kept in extension storage and shared with the
 * background worker, which proxies every backend call for content scripts.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { browser } from "wxt/browser";
import { ApiClient, isApiError } from "./api";
import { BACKEND_URL, CONSOLE_URL } from "./config";

const TOKEN_KEY = "glance:session";

export interface GlanceAuth {
  ready: boolean;
  authenticated: boolean;
  owner: string | null;
  token: string | null;
  /** Open the console sign-in page and resolve when the handoff completes (or times out). */
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  getTokens(): Promise<{ accessToken: string | null }>;
  /** Open the console at a given action, carrying the session token so it does not have to sign in again. */
  openConsole(path: string, params?: Record<string, string>): Promise<void>;
  signingIn: boolean;
  error: string | null;
}

const Ctx = createContext<GlanceAuth | null>(null);
export function useGlanceAuth(): GlanceAuth {
  const v = useContext(Ctx);
  if (!v) throw new Error("useGlanceAuth outside GlanceAuthProvider");
  return v;
}

async function publishTokens(accessToken: string | null) {
  try {
    await browser.runtime.sendMessage({ type: "set-auth", accessToken });
  } catch {
    /* background not ready */
  }
}

function decodeOwner(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as { sub?: string; exp?: number };
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

export function GlanceAuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    void browser.storage.local.get(TOKEN_KEY).then((r) => {
      const t = (r as Record<string, string | undefined>)[TOKEN_KEY] ?? null;
      const valid = t && decodeOwner(t) ? t : null;
      setToken(valid);
      void publishTokens(valid);
      setReady(true);
    });
    const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === "local" && TOKEN_KEY in changes) {
        const t = (changes[TOKEN_KEY]!.newValue as string | undefined) ?? null;
        setToken(t && decodeOwner(t) ? t : null);
      }
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, []);

  const owner = useMemo(() => (token ? decodeOwner(token) : null), [token]);
  const getTokens = useCallback(async () => ({ accessToken: token }), [token]);

  const setSession = useCallback(async (t: string | null) => {
    setToken(t);
    if (t) await browser.storage.local.set({ [TOKEN_KEY]: t });
    else await browser.storage.local.remove(TOKEN_KEY);
    await publishTokens(t);
  }, []);

  const signIn = useCallback(async () => {
    setError(null);
    setSigningIn(true);
    pollAbort.current?.abort();
    const ac = new AbortController();
    pollAbort.current = ac;
    try {
      const anon = new ApiClient(async () => ({ accessToken: null }));
      const start = await anon.post<{ ok: true; code: string; expiresAt: string }>("/auth/handoff/start");
      if (isApiError(start)) throw new Error(start.message);
      await browser.tabs.create({ url: `${CONSOLE_URL}/connect?code=${encodeURIComponent(start.code)}&backend=${encodeURIComponent(BACKEND_URL)}` });
      const deadline = Date.now() + 10 * 60_000;
      while (Date.now() < deadline && !ac.signal.aborted) {
        await new Promise((r) => setTimeout(r, 1500));
        const res = await anon.get<{ ok: true; status: "pending" | "ready"; token?: string; owner?: string }>(`/auth/handoff/${start.code}`);
        if (isApiError(res)) throw new Error(res.message);
        if (res.status === "ready" && res.token) {
          await setSession(res.token);
          return;
        }
      }
      if (!ac.signal.aborted) setError("Sign-in timed out. Try again.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in didn't complete.");
    } finally {
      setSigningIn(false);
    }
  }, [setSession]);

  const signOut = useCallback(async () => {
    pollAbort.current?.abort();
    await setSession(null);
  }, [setSession]);

  const openConsole = useCallback(
    async (path: string, params: Record<string, string> = {}) => {
      const q = new URLSearchParams({ ...params, backend: BACKEND_URL, ...(token ? { session: token } : {}) });
      await browser.tabs.create({ url: `${CONSOLE_URL}${path}?${q.toString()}` });
    },
    [token],
  );

  const value: GlanceAuth = { ready, authenticated: !!owner, owner, token, signIn, signOut, getTokens, openConsole, signingIn, error };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
