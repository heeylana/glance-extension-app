/**
 * The last portfolio seen for each vault, in chrome.storage.local (`glance:portfolio:<vault>`), so the side panel opens
 * on a known value with its age instead of blank, then refreshes behind it. The last vault each owner used is kept too
 * (`glance:last-vault`), so the lookup need not wait for /session. A cache failure is a miss, never an error.
 */
import { browser } from "wxt/browser";
import type { Portfolio } from "./api-types";

export const PORTFOLIO_CACHE_PREFIX = "glance:portfolio:";
export const LAST_VAULT_KEY = "glance:last-vault";

export interface CachedPortfolio {
  at: number;
  data: Portfolio;
}

/** Base58 addresses are case-sensitive: the key is the address exactly as given. */
const keyFor = (vault: string) => PORTFOLIO_CACHE_PREFIX + vault;

export async function cachedPortfolio(vault: string): Promise<CachedPortfolio | null> {
  try {
    const key = keyFor(vault);
    const r = (await browser.storage.local.get(key)) as Record<string, Partial<CachedPortfolio> | undefined> | undefined;
    const hit = r?.[key];
    return hit && typeof hit.at === "number" && hit.data && typeof hit.data === "object" ? (hit as CachedPortfolio) : null;
  } catch {
    return null;
  }
}

export async function savePortfolio(vault: string, data: Portfolio, at = Date.now()): Promise<void> {
  try {
    await browser.storage.local.set({ [keyFor(vault)]: { at, data } satisfies CachedPortfolio });
  } catch {
    // Best effort: the next open just starts without a cached value.
  }
}

/** The vault this owner last had, or null if unknown or it belonged to someone else. */
export async function rememberedVault(owner: string): Promise<string | null> {
  try {
    const r = (await browser.storage.local.get(LAST_VAULT_KEY)) as Record<string, { owner?: unknown; vault?: unknown } | undefined> | undefined;
    const hit = r?.[LAST_VAULT_KEY];
    return hit && hit.owner === owner && typeof hit.vault === "string" && hit.vault ? hit.vault : null;
  } catch {
    return null;
  }
}

export async function rememberVault(owner: string, vault: string): Promise<void> {
  try {
    await browser.storage.local.set({ [LAST_VAULT_KEY]: { owner, vault } });
  } catch {
    // Best effort: the next open waits for /session instead.
  }
}

/** "Last known 5 minutes ago": how old the shown value is. */
export function cacheAge(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return "Last known a moment ago";
  const m = Math.floor(s / 60);
  if (m < 60) return `Last known ${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Last known ${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `Last known ${d} day${d === 1 ? "" : "s"} ago`;
}
