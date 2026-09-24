/**
 * Typed messages between the content script, the background worker, and the
 * side panel. Content scripts never talk to the backend or Privy directly:
 * the background attaches the auth token and forwards (spec §5, §7.1).
 */
import type { GlanceInput, GlanceVisionInput, GlanceResult, BuyResult, WhyResult, CounterViewResult, PriceRow, ApiError, Dictionary, VoiceContext, VoiceResult, ExplainInput, ExplainResult, SessionView, Portfolio, RememberInput, RememberResult, CompanyResult, CompanyHistory, AdviceResult } from "./api-types";

export type BgRequest =
  | { type: "glance"; input: GlanceInput }
  | { type: "glance-vision"; input: GlanceVisionInput }
  | { type: "buy"; outputMint: string; usdcAmount: number; context: GlanceInput["context"] }
  | { type: "why"; ticker: string }
  /** Start the "why did it move?" answer while the user is still talking, so it is ready when they ask. */
  | { type: "warm-why"; ticker: string }
  | { type: "company"; companyId?: string; ticker?: string }
  /** "What do you think of Nvidia?": the read, with its disclaimer. */
  | { type: "advice"; companyId?: string; ticker?: string }
  /** The day's prices for the card's chart, fetched after the card is up so it never holds the answer back. */
  | { type: "company-history"; mint: string }
  | { type: "counter-view"; ticker: string }
  | { type: "tts"; text: string }
  /** Play a fetched clip in the offscreen document, where the page's CSP and autoplay rules cannot block it. Answers when it has been heard. */
  | { type: "play-audio"; audio: string; mime: string }
  | { type: "stop-audio" }
  | { type: "prices"; tickers: string[] }
  | { type: "dictionary" }
  | { type: "capture-visible-tab" }
  | { type: "auth-status" }
  | { type: "open-side-panel" }
  | { type: "set-auth"; accessToken: string | null }
  | { type: "glance-happened" }
  | { type: "watch"; companyId: string }
  | { type: "listen-start" }
  | { type: "listen-stop"; context: VoiceContext }
  | { type: "listen-cancel" }
  | { type: "journal-note"; id: number; note: string }
  | { type: "open-mic-setup" }
  | { type: "explain"; input: ExplainInput }
  | { type: "remember"; input: RememberInput }
  | { type: "open-tab"; url: string }
  | { type: "session" }
  | { type: "portfolio" }
  | { type: "sell"; ticker: string; usd?: number; stockAmountRaw?: string; context: GlanceInput["context"] };

export type BgResponse<T extends BgRequest["type"]> = T extends "glance" | "glance-vision"
  ? GlanceResult | ApiError
  : T extends "buy" | "sell"
    ? BuyResult | ApiError
    : T extends "session"
      ? SessionView | ApiError
      : T extends "portfolio"
        ? Portfolio | ApiError
    : T extends "why"
      ? WhyResult | ApiError
      : T extends "company"
        ? CompanyResult | ApiError
        : T extends "advice"
          ? AdviceResult | ApiError
        : T extends "company-history"
          ? CompanyHistory | ApiError
      : T extends "counter-view"
        ? CounterViewResult | ApiError
        : T extends "tts"
          ? { ok: true; audio: string; mime: string } | ApiError
        : T extends "play-audio"
          ? { ok: true; stopped?: boolean } | ApiError
      : T extends "prices"
        ? { ok: true; prices: PriceRow[] } | ApiError
        : T extends "dictionary"
          ? Dictionary
          : T extends "capture-visible-tab"
            ? { ok: true; dataUrl: string } | ApiError
            : T extends "auth-status"
              ? { signedIn: boolean }
              : T extends "watch"
                ? { ok: true; message: string } | ApiError
                : T extends "listen-start" | "journal-note"
                  ? { ok: true } | ApiError
                  : T extends "listen-stop"
                    ? VoiceResult | ApiError
                    : T extends "explain"
                      ? ExplainResult | ApiError
                      : T extends "remember"
                        ? RememberResult | ApiError
                        : { ok: true };

/**
 * Background → the offscreen push-to-talk recorder (entrypoints/recorder). Tagged with `target`
 * because every extension page hears every runtime message; the recorder answers only these.
 */
export type RecorderRequest =
  | { target: "recorder"; type: "start" | "stop" | "cancel" | "hush" }
  /** Glance's spoken line. Answers once it has played to the end, been hushed, or failed. */
  | { target: "recorder"; type: "play"; audio: string; mime: string };
export type RecorderStart = { ok: true } | ApiError;
/** A finished take: 16 kHz mono WAV as a data URL, its length, and its loudest sample. */
export type RecorderTake = { ok: true; wav: string; seconds: number; peak: number } | ApiError;

/** Messages the background pushes to a tab's content script. */
export type TabMessage = { type: "trigger-glance" } | { type: "auth-changed"; signedIn: boolean };

export function isBgRequest(m: unknown): m is BgRequest {
  return typeof m === "object" && m !== null && typeof (m as { type?: unknown }).type === "string";
}
