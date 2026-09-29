/**
 * Every failed trade gets exactly one way on, in plain words: a failure is never just a message the user has to decode.
 * Codes are glance-backend's GuardCode list plus the client's own OFFLINE / BAD_RESPONSE / HTTP_*. Anything not named
 * here (price, route, simulation, submit failures) gets "Try again". The caller keeps the message as it is.
 */
import type { ApiError } from "./api-types";
import { CONSOLE_URL } from "./config";

export type ErrorAction =
  /** Opens the web console in a new tab: money in, limits and renewals need the owner's wallet. */
  | { kind: "open-console"; label: string; url: string }
  /** From the page: opens the side panel. */
  | { kind: "open-panel"; label: string }
  /** From the panel: starts the wallet sign-in again. */
  | { kind: "sign-in"; label: string }
  /** Not on-chain yet: add the company to the watchlist, as the backend's message offers. */
  | { kind: "watch"; label: string }
  /** Lookalike token: buy the real mint instead. */
  | { kind: "buy-real"; label: string; mint: string }
  /** Over the daily cap with room left: buy what still fits. */
  | { kind: "buy-amount"; label: string; amountUsd: number }
  | { kind: "try-again"; label: string };

export interface ErrorActionContext {
  /** Where the failure is shown: the in-page card or the side panel. */
  where: "page" | "panel";
  side: "buy" | "sell";
  /** The company's name, for "Buy the real Nvidia". */
  name?: string;
}

const consoleUrl = (action: string) => `${CONSOLE_URL}/account?action=${action}`;

export const TRY_AGAIN: ErrorAction = { kind: "try-again", label: "Try again" };

export function errorAction(err: Pick<ApiError, "code" | "remainingUsd" | "realMint">, ctx: ErrorActionContext): ErrorAction {
  switch (err.code) {
    case "OUTPUT_MINT_NOT_ISSUER":
      return ctx.side === "buy" && err.realMint ? { kind: "buy-real", label: `Buy the real ${ctx.name ?? "one"}`, mint: err.realMint } : TRY_AGAIN;
    case "OVER_DAILY_CAP":
      if (ctx.side === "buy" && err.remainingUsd && err.remainingUsd >= 1) {
        const amt = Math.floor(err.remainingUsd);
        return { kind: "buy-amount", label: `Buy $${amt} now`, amountUsd: amt };
      }
      return { kind: "open-console", label: "Change my limit", url: consoleUrl("limit") };
    case "OVER_PER_TX_CAP":
      return { kind: "open-console", label: "Change my limit", url: consoleUrl("limit") };
    case "MINT_NOT_TOKENIZED":
      return ctx.side === "buy" ? { kind: "watch", label: "Tell me when it lists" } : TRY_AGAIN;
    case "SESSION_PAUSED":
      return { kind: "open-console", label: "Unpause", url: consoleUrl("unpause") };
    case "INSUFFICIENT_FUNDS":
      return { kind: "open-console", label: "Add money", url: consoleUrl("deposit") };
    case "SESSION_EXPIRED":
      return { kind: "open-console", label: "Renew", url: consoleUrl("renew") };
    case "NO_SESSION":
    case "AUTH_INVALID":
    case "WALLET_MISMATCH":
      return ctx.where === "page" ? { kind: "open-panel", label: "Open Glance" } : { kind: "sign-in", label: "Sign in again" };
    default:
      return TRY_AGAIN;
  }
}
