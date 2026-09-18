/** Build-time configuration. WXT exposes `WXT_*` env vars to the bundle. */
export const BACKEND_URL = (import.meta.env.WXT_BACKEND_URL as string | undefined) ?? "http://localhost:8787";
/** Phantom-facing web console (glance-web): sign-in, create account, deposit, withdraw, pause. */
export const CONSOLE_URL = ((import.meta.env.WXT_CONSOLE_URL as string | undefined) ?? "http://localhost:5173").replace(/\/$/, "");
export const SOLANA_CLUSTER = ((import.meta.env.WXT_SOLANA_CLUSTER as string | undefined) ?? "devnet") as "devnet" | "mainnet-beta";
export const SOLANA_RPC_URL =
  (import.meta.env.WXT_SOLANA_RPC_URL as string | undefined) ??
  (SOLANA_CLUSTER === "devnet" ? "https://api.devnet.solana.com" : "https://api.mainnet-beta.solana.com");
export const USDC_MINT = (import.meta.env.WXT_USDC_MINT as string | undefined) ?? "";

export const AMOUNT_CHIPS = [5, 10, 25] as const;
export const DEFAULT_DAILY_CAP_USD = 20;
export const SESSION_DAYS = 7;
