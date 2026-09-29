import { describe, expect, it } from "vitest";
import { CONSOLE_URL } from "../config";
import { errorAction, TRY_AGAIN, type ErrorAction, type ErrorActionContext } from "../error-action";

const pageBuy: ErrorActionContext = { where: "page", side: "buy", name: "Nvidia" };
const pageSell: ErrorActionContext = { where: "page", side: "sell", name: "Nvidia" };
const panelSell: ErrorActionContext = { where: "panel", side: "sell", name: "Nvidia" };
const contexts = [pageBuy, pageSell, panelSell];

/** Every code the extension can receive today (see the module note). */
const MAPPED = ["OUTPUT_MINT_NOT_ISSUER", "OVER_DAILY_CAP", "OVER_PER_TX_CAP", "INSUFFICIENT_FUNDS", "SESSION_EXPIRED", "SESSION_PAUSED", "NO_SESSION", "AUTH_INVALID", "WALLET_MISMATCH", "MINT_NOT_TOKENIZED"];
/** GuardCodes that have no specific way on: they retry. */
const RETRY = ["INPUT_MINT_NOT_STABLE", "DESTINATION_NOT_USER", "INPUT_DEBIT_MISMATCH", "OUTPUT_BELOW_MIN", "SOL_SPEND_EXCEEDED", "FEE_PAYER_MISMATCH", "DISALLOWED_PROGRAM", "PRICE_DEVIATION", "PRICE_UNAVAILABLE", "SIMULATION_FAILED", "ROUTE_UNAVAILABLE", "FUNDING_UNAVAILABLE", "SIGNER_REJECTED", "SUBMIT_FAILED", "BAD_REQUEST", "VOICE_UNAVAILABLE", "EXPLAIN_UNAVAILABLE", "REMEMBER_UNAVAILABLE"];
const CLIENT = ["OFFLINE", "BAD_RESPONSE", "HTTP_500", "HTTP_404"];

/** Exactly one action: a single object with one kind and a non-empty label, never a list. */
function expectOne(a: ErrorAction) {
  expect(Array.isArray(a)).toBe(false);
  expect(typeof a.kind).toBe("string");
  expect(a.label.trim().length).toBeGreaterThan(0);
}

describe("errorAction", () => {
  it("gives every mapped and client code exactly one action, in every context", () => {
    for (const code of [...MAPPED, ...RETRY, ...CLIENT]) for (const ctx of contexts) expectOne(errorAction({ code, remainingUsd: 7.6, realMint: "RealMint" }, ctx));
  });

  it("maps each known code to its one way on", () => {
    expect(errorAction({ code: "OUTPUT_MINT_NOT_ISSUER", realMint: "RealMint" }, pageBuy)).toEqual({ kind: "buy-real", label: "Buy the real Nvidia", mint: "RealMint" });
    expect(errorAction({ code: "OVER_DAILY_CAP", remainingUsd: 7.6 }, pageBuy)).toEqual({ kind: "buy-amount", label: "Buy $7 now", amountUsd: 7 });
    expect(errorAction({ code: "OVER_DAILY_CAP", remainingUsd: 0.4 }, pageBuy)).toEqual({ kind: "open-console", label: "Change my limit", url: `${CONSOLE_URL}/account?action=limit` });
    expect(errorAction({ code: "OVER_DAILY_CAP", remainingUsd: 7.6 }, pageSell).kind).toBe("open-console");
    expect(errorAction({ code: "INSUFFICIENT_FUNDS" }, pageBuy)).toEqual({ kind: "open-console", label: "Add money", url: `${CONSOLE_URL}/account?action=deposit` });
    expect(errorAction({ code: "SESSION_EXPIRED" }, panelSell)).toEqual({ kind: "open-console", label: "Renew", url: `${CONSOLE_URL}/account?action=renew` });
    expect(errorAction({ code: "NO_SESSION" }, pageBuy)).toEqual({ kind: "open-panel", label: "Open Glance" });
    expect(errorAction({ code: "AUTH_INVALID" }, pageSell)).toEqual({ kind: "open-panel", label: "Open Glance" });
    expect(errorAction({ code: "AUTH_INVALID" }, panelSell)).toEqual({ kind: "sign-in", label: "Sign in again" });
  });

  it("SESSION_PAUSED opens the console to unpause", () => {
    for (const ctx of contexts) expect(errorAction({ code: "SESSION_PAUSED" }, ctx)).toEqual({ kind: "open-console", label: "Unpause", url: `${CONSOLE_URL}/account?action=unpause` });
  });

  it("MINT_NOT_TOKENIZED adds the company to the watchlist when buying", () => {
    expect(errorAction({ code: "MINT_NOT_TOKENIZED" }, pageBuy)).toEqual({ kind: "watch", label: "Tell me when it lists" });
    expect(errorAction({ code: "MINT_NOT_TOKENIZED" }, panelSell)).toEqual(TRY_AGAIN);
  });

  it("OVER_PER_TX_CAP opens the same limit page as the daily cap", () => {
    const limit = { kind: "open-console", label: "Change my limit", url: `${CONSOLE_URL}/account?action=limit` };
    for (const ctx of contexts) expect(errorAction({ code: "OVER_PER_TX_CAP", remainingUsd: 7.6 }, ctx)).toEqual(limit);
    expect(errorAction({ code: "OVER_DAILY_CAP" }, pageSell)).toEqual(limit);
  });

  it("WALLET_MISMATCH does exactly what AUTH_INVALID does", () => {
    for (const ctx of contexts) expect(errorAction({ code: "WALLET_MISMATCH" }, ctx)).toEqual(errorAction({ code: "AUTH_INVALID" }, ctx));
    expect(errorAction({ code: "WALLET_MISMATCH" }, panelSell)).toEqual({ kind: "sign-in", label: "Sign in again" });
  });

  it("sends the price, route, simulation and submit failures to Try again", () => {
    for (const code of RETRY) for (const ctx of contexts) expect(errorAction({ code }, ctx)).toEqual(TRY_AGAIN);
  });

  it("falls back to Try again for client failures and when the specific action can't apply", () => {
    for (const code of CLIENT) expect(errorAction({ code }, pageBuy)).toEqual(TRY_AGAIN);
    expect(errorAction({ code: "OUTPUT_MINT_NOT_ISSUER" }, pageBuy)).toEqual(TRY_AGAIN);
    expect(errorAction({ code: "OUTPUT_MINT_NOT_ISSUER", realMint: "RealMint" }, pageSell)).toEqual(TRY_AGAIN);
  });

  it("returns the catch-all for an unknown code", () => {
    for (const ctx of contexts) expect(errorAction({ code: "SOMETHING_NEW" }, ctx)).toEqual({ kind: "try-again", label: "Try again" });
    expect(errorAction({ code: "" }, pageBuy)).toEqual(TRY_AGAIN);
  });
});
