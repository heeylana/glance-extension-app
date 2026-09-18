/**
 * Background worker: the only place in the extension that talks to the backend
 * on behalf of pages. Holds the session token the side panel hands it (session
 * storage, cleared when the browser closes), relays the hotkey, opens the side
 * panel, caches the dictionary, and runs the push-to-talk recorder.
 */
import { defineBackground } from "wxt/utils/define-background";
import { browser } from "wxt/browser";
import { ApiClient } from "../lib/api";
import { toBase64 } from "../lib/audio";
import { openMicSetup } from "../lib/mic";
import type { BgRequest, RecorderRequest, RecorderStart, RecorderTake, TabMessage } from "../lib/messages";
import type { Dictionary, VoiceResult } from "../lib/api-types";

const TOKENS_KEY = "glance:tokens";
const DICT_KEY = "glance:dictionary";
const DICT_TTL_MS = 60 * 60 * 1000;
/** Spoken lines repeat; keep the last few clips so a repeat never leaves the worker. */
const TTS_CACHE_MAX = 40;
const ttsCache = new Map<string, { audio: string; mime: string }>();

async function getTokens(): Promise<{ accessToken: string | null }> {
  const r = (await browser.storage.session.get(TOKENS_KEY)) as Record<string, { accessToken: string | null } | undefined>;
  return r[TOKENS_KEY] ?? { accessToken: null };
}

const api = new ApiClient(getTokens);

async function loadDictionary(): Promise<Dictionary> {
  const cached = (await browser.storage.local.get(DICT_KEY)) as Record<string, { at: number; dict: Dictionary } | undefined>;
  const hit = cached[DICT_KEY];
  if (hit && Date.now() - hit.at < DICT_TTL_MS) return hit.dict;
  const dict = await api.get<Dictionary>("/dictionary");
  if (dict.ok) {
    await browser.storage.local.set({ [DICT_KEY]: { at: Date.now(), dict } });
    return dict;
  }
  if (hit) return hit.dict;
  throw new Error(dict.message);
}

// ---- Push-to-talk (spec §7.4): an offscreen document records while the user holds the key ----
const RECORDER_URL = "/recorder.html" as const;
/** Shorter than this, or quieter than this, is a tap or a muted microphone: nothing to transcribe. */
const MIN_TAKE_SECONDS = 0.3;
const SILENT_PEAK = 0.005;
let creatingRecorder: Promise<void> | null = null;

async function ensureRecorder(): Promise<boolean> {
  if (!browser.offscreen) return false; // Firefox
  const open = await browser.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [browser.runtime.getURL(RECORDER_URL)] });
  if (open.length > 0) return true;
  creatingRecorder ??= browser.offscreen
    .createDocument({ url: RECORDER_URL, reasons: ["USER_MEDIA"], justification: "Records a spoken command while the user holds the Glance talk key." })
    .finally(() => (creatingRecorder = null));
  await creatingRecorder;
  return true;
}

function recorder<T>(type: RecorderRequest["type"]): Promise<T> {
  return browser.runtime.sendMessage({ target: "recorder", type } satisfies RecorderRequest) as Promise<T>;
}

async function broadcast(msg: TabMessage) {
  const tabs = await browser.tabs.query({});
  await Promise.all(tabs.map((t) => (t.id ? browser.tabs.sendMessage(t.id, msg).catch(() => undefined) : undefined)));
}

export default defineBackground(() => {
  // Action click opens the side panel (Chrome). Firefox uses a sidebar action instead.
  const sp = (browser as unknown as { sidePanel?: { setPanelBehavior: (o: { openPanelOnActionClick: boolean }) => Promise<void>; open: (o: { tabId?: number; windowId?: number }) => Promise<void> } }).sidePanel;
  sp?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === "install") {
      // Spec §7.2 step 1: install → side panel. Chrome only opens panels on a user gesture, so open the onboarding page in a tab.
      void browser.tabs.create({ url: browser.runtime.getURL("/sidepanel.html?welcome=1") });
    }
  });

  browser.commands.onCommand.addListener(async (command) => {
    if (command !== "glance") return;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) await browser.tabs.sendMessage(tab.id, { type: "trigger-glance" } satisfies TabMessage).catch(() => undefined);
  });

  browser.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
    const msg = raw as BgRequest;
    if (!msg || typeof msg.type !== "string") return false;
    (async () => {
      switch (msg.type) {
        case "dictionary":
          return loadDictionary();
        case "glance":
          return api.post("/glance", msg.input);
        case "glance-vision":
          // Spec §7.3 fallback: the screenshot goes to the backend once and is not kept anywhere.
          return api.post("/glance/vision", msg.input);
        case "buy":
          return api.post("/buy", { outputMint: msg.outputMint, usdcAmount: msg.usdcAmount, context: msg.context });
        case "why":
          return api.post("/why", { ticker: msg.ticker });
        case "counter-view":
          return api.post("/counter-view", { ticker: msg.ticker });
        case "tts": {
          const key = msg.text.trim().toLowerCase();
          const hit = ttsCache.get(key);
          if (hit) return { ok: true, ...hit };
          const r = await api.postBytes("/tts", { text: msg.text });
          if (!r.ok) return r;
          const clip = { audio: toBase64(r.bytes), mime: r.mime };
          ttsCache.set(key, clip);
          if (ttsCache.size > TTS_CACHE_MAX) ttsCache.delete(ttsCache.keys().next().value!);
          return { ok: true, ...clip };
        }
        case "prices":
          return api.get(`/prices?tickers=${encodeURIComponent(msg.tickers.join(","))}`);
        case "watch":
          return api.post("/watchlist", { companyId: msg.companyId });
        case "listen-start":
          if (!(await ensureRecorder())) return { ok: false, code: "VOICE_UNSUPPORTED", message: "Talking to Glance needs Chrome, Brave, Edge or Arc." };
          return recorder<RecorderStart>("start");
        case "listen-cancel":
          if (browser.offscreen) await recorder("cancel").catch(() => undefined);
          return { ok: true };
        case "listen-stop": {
          const take = await recorder<RecorderTake>("stop");
          if (!take.ok) return take;
          if (take.seconds < MIN_TAKE_SECONDS || take.peak < SILENT_PEAK) {
            return { ok: true, transcript: "", command: { kind: "unknown", amountUsd: null, companyId: null, note: null, direction: null, all: null }, via: "none" } satisfies VoiceResult;
          }
          return api.post("/voice", { audio: take.wav, context: msg.context });
        }
        case "explain":
          return api.post("/explain", msg.input);
        case "remember":
          return api.post("/remember", msg.input);
        case "session":
          return api.get("/session");
        case "portfolio":
          return api.get("/portfolio");
        case "sell":
          return api.post("/sell", { ticker: msg.ticker, usd: msg.usd, stockAmountRaw: msg.stockAmountRaw, context: msg.context });
        case "open-tab": {
          // "Show me" opening a link that wants a new tab: from here it is not blocked as a popup.
          if (!/^https?:\/\//i.test(msg.url)) return { ok: false, code: "BAD_URL", message: "That link doesn't open a web page." };
          await browser.tabs.create({ url: msg.url, index: sender.tab ? sender.tab.index + 1 : undefined, openerTabId: sender.tab?.id });
          return { ok: true };
        }
        case "journal-note":
          return api.patch(`/journal/${msg.id}`, { note: msg.note });
        case "open-mic-setup":
          await openMicSetup();
          return { ok: true };
        case "capture-visible-tab": {
          const opts = { format: "jpeg" as const, quality: 60 };
          const windowId = sender.tab?.windowId;
          const dataUrl = windowId !== undefined ? await browser.tabs.captureVisibleTab(windowId, opts) : await browser.tabs.captureVisibleTab(opts);
          return { ok: true, dataUrl };
        }
        case "auth-status": {
          const t = await getTokens();
          return { signedIn: !!t.accessToken };
        }
        case "set-auth": {
          await browser.storage.session.set({ [TOKENS_KEY]: { accessToken: msg.accessToken } });
          void broadcast({ type: "auth-changed", signedIn: !!msg.accessToken });
          return { ok: true };
        }
        case "open-side-panel": {
          const tabId = sender.tab?.id;
          const windowId = sender.tab?.windowId;
          if (sp) await sp.open(tabId ? { tabId } : { windowId }).catch(() => undefined);
          return { ok: true };
        }
        case "glance-happened": {
          const cur = (await browser.storage.local.get("glance:firstGlanceAt")) as Record<string, string | undefined>;
          if (!cur["glance:firstGlanceAt"]) await browser.storage.local.set({ "glance:firstGlanceAt": new Date().toISOString() });
          return { ok: true };
        }
        default:
          return { ok: false, code: "UNKNOWN_MESSAGE", message: "Unknown message" };
      }
    })().then(sendResponse, (e) => sendResponse({ ok: false, code: "BG_ERROR", message: "Glance is offline right now. Your money is safe in your account.", detail: String(e) }));
    return true; // async response
  });
});
