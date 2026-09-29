import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Portfolio } from "../api-types";

const store = new Map<string, unknown>();
const local = {
  get: vi.fn(async (key: string) => (store.has(key) ? { [key]: store.get(key) } : {})),
  set: vi.fn(async (items: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(items)) store.set(k, v);
  }),
};
vi.mock("wxt/browser", () => ({ browser: { storage: { local } } }));

const { cacheAge, cachedPortfolio, rememberVault, rememberedVault, savePortfolio } = await import("../portfolio-cache");

const NOW = Date.parse("2026-09-29T12:00:00Z");
const VAULT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const portfolio: Portfolio = {
  ok: true,
  wallet: "wallet",
  vault: VAULT,
  exists: true,
  cashUsd: 12.5,
  holdings: [],
  totalUsd: 40,
  paused: false,
  remainingTodayUsd: 20,
};

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("cachedPortfolio and savePortfolio", () => {
  it("misses when nothing is saved", async () => {
    expect(await cachedPortfolio(VAULT)).toBeNull();
  });
  it("reads back what was saved", async () => {
    await savePortfolio(VAULT, portfolio, NOW);
    expect(await cachedPortfolio(VAULT)).toEqual({ at: NOW, data: portfolio });
    expect(await cachedPortfolio("otherVault")).toBeNull();
  });
  it("keys by the exact address: vaults differing only in case are different entries", async () => {
    const lower = VAULT.toLowerCase();
    const other = { ...portfolio, vault: lower, totalUsd: 99 };
    await savePortfolio(VAULT, portfolio, NOW);
    expect(await cachedPortfolio(lower)).toBeNull();
    await savePortfolio(lower, other, NOW + 1);
    expect(await cachedPortfolio(VAULT)).toEqual({ at: NOW, data: portfolio });
    expect(await cachedPortfolio(lower)).toEqual({ at: NOW + 1, data: other });
  });
  it("treats a storage failure as a miss", async () => {
    local.get.mockRejectedValueOnce(new Error("storage unavailable"));
    expect(await cachedPortfolio(VAULT)).toBeNull();
  });
  it("treats storage returning nothing as a miss", async () => {
    local.get.mockResolvedValueOnce(undefined as never);
    expect(await cachedPortfolio(VAULT)).toBeNull();
  });
  it("swallows a failed save", async () => {
    local.set.mockRejectedValueOnce(new Error("quota"));
    await expect(savePortfolio(VAULT, portfolio, NOW)).resolves.toBeUndefined();
  });
});

describe("rememberedVault and rememberVault", () => {
  it("misses when nothing is remembered", async () => {
    expect(await rememberedVault("owner-a")).toBeNull();
  });
  it("returns the vault only to the owner who used it", async () => {
    await rememberVault("owner-a", VAULT);
    expect(await rememberedVault("owner-a")).toBe(VAULT);
    expect(await rememberedVault("owner-b")).toBeNull();
  });
  it("keeps the latest vault", async () => {
    await rememberVault("owner-a", VAULT);
    await rememberVault("owner-a", "newVault");
    expect(await rememberedVault("owner-a")).toBe("newVault");
  });
  it("treats a storage failure as a miss", async () => {
    await rememberVault("owner-a", VAULT);
    local.get.mockRejectedValueOnce(new Error("storage unavailable"));
    expect(await rememberedVault("owner-a")).toBeNull();
  });
  it("swallows a failed write", async () => {
    local.set.mockRejectedValueOnce(new Error("quota"));
    await expect(rememberVault("owner-a", VAULT)).resolves.toBeUndefined();
  });
});

describe("cacheAge", () => {
  const ago = (ms: number) => cacheAge(NOW - ms, NOW);
  it("seconds", () => {
    expect(ago(0)).toBe("Last known a moment ago");
    expect(ago(59_999)).toBe("Last known a moment ago");
    expect(cacheAge(NOW + 5_000, NOW)).toBe("Last known a moment ago");
  });
  it("minutes", () => {
    expect(ago(60_000)).toBe("Last known 1 minute ago");
    expect(ago(5 * 60_000)).toBe("Last known 5 minutes ago");
    expect(ago(3_600_000 - 1)).toBe("Last known 59 minutes ago");
  });
  it("hours", () => {
    expect(ago(3_600_000)).toBe("Last known 1 hour ago");
    expect(ago(2 * 3_600_000)).toBe("Last known 2 hours ago");
    expect(ago(24 * 3_600_000 - 1)).toBe("Last known 23 hours ago");
  });
  it("days", () => {
    expect(ago(24 * 3_600_000)).toBe("Last known 1 day ago");
    expect(ago(3 * 24 * 3_600_000)).toBe("Last known 3 days ago");
  });
});
