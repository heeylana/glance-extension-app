import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ApiError, Portfolio } from "../api-types";
import type { CachedPortfolio } from "../portfolio-cache";

vi.mock("wxt/browser", () => ({ browser: { storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {}, removeListener() {} } } } }));

const { CachedAge, cachedView } = await import("../../entrypoints/sidepanel/screens/Portfolio");

const NOW = Date.parse("2026-09-29T12:00:00Z");
const VAULT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const cached: CachedPortfolio = {
  at: NOW - 5 * 60_000,
  data: { ok: true, wallet: "wallet", vault: VAULT, exists: true, cashUsd: 12.5, holdings: [], totalUsd: 40, paused: false, remainingTodayUsd: 5 } satisfies Portfolio,
};
const offline = { ok: false, code: "NETWORK", message: "Failed to fetch" } as unknown as ApiError;

/** What the screen renders for a live-fetch state when the panel opened from cache: the age line, or nothing. */
function ageLine(q: { data: Portfolio | null; error: ApiError | null; loading: boolean }, now = NOW): string | null {
  const stale = cachedView(q, cached, VAULT);
  if (!stale) return null;
  // The screen falls back to the skeleton or the error box only when there is no cached view.
  expect(q.loading && !q.data && !stale).toBe(false);
  expect(q.error && !q.data && !stale).toBeFalsy();
  return renderToStaticMarkup(createElement(CachedAge, { at: stale.at, now }));
}

describe("age line when the panel opens from cache", () => {
  it("shows while the live fetch is in flight", () => {
    expect(ageLine({ data: null, error: null, loading: true })).toContain("Last known 5 minutes ago");
  });
  it("shows when the live fetch fails", () => {
    expect(ageLine({ data: null, error: offline, loading: false })).toContain("Last known 5 minutes ago");
  });
  it("shows while the live fetch is slow, past the poll and the request timeout", () => {
    expect(ageLine({ data: null, error: null, loading: true }, NOW + 25_000)).toContain("Last known 5 minutes ago");
    expect(ageLine({ data: null, error: offline, loading: false }, NOW + 45_000)).toContain("Last known 5 minutes ago");
  });
  it("goes away once live data arrives", () => {
    expect(ageLine({ data: cached.data, error: null, loading: false })).toBeNull();
  });
});
