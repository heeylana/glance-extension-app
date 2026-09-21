import "./bubble.css";
import "./beam.generated.css";
import { defineContentScript } from "wxt/utils/define-content-script";
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root";
import { browser } from "wxt/browser";
import { Matcher } from "../../lib/dictionary";
import { Underliner } from "../../lib/highlights";
import { collectContext, primeAdapters, readableText } from "../../lib/adapters";
import { pickNotes, toExplainMemory } from "../../lib/memory";
import { keepNote, loadNotes } from "../../lib/memory-store";
import { Bubble } from "./bubble";
import { runCommand } from "./voice";
import { Sketch } from "./sketch";
import { MAP_MAX_WIDTH, mapPage, questionTerms, shrinkScreenshot, type PageMap } from "../../lib/page-map";
import { clickLikeAPerson, clickTarget, inView, labelOf, newTabHref, refusal, scrollScreen, scrollToElement } from "./act";
import type { BgRequest, BgResponse, TabMessage } from "../../lib/messages";
import type { ApiError, Dictionary, DictionaryCompany, ExplainAction, ExplainMemory, ExplainStep, GlanceEntity, GlanceInput, GlanceResult, PriceRow, SketchMark, TokenMarket } from "../../lib/api-types";
import { usd } from "../../lib/format";

const OFFLINE = "Glance is offline right now. Your money is safe in your account.";
/** Push-to-talk (spec §7.4): hold ⌥V. ⌥G stays a tap; Chrome's command API never reports a key release, so holding is read here. */
const TALK_CODE = "KeyV";
/** Shorter than this is a tap, not a take. */
const MIN_TALK_MS = 300;
/** Speech runs a moment past the key release. */
const TALK_TAIL_MS = 200;
const MAX_TALK_MS = 30_000;

function send<T extends BgRequest["type"]>(msg: Extract<BgRequest, { type: T }>): Promise<BgResponse<T>> {
  return browser.runtime.sendMessage(msg) as Promise<BgResponse<T>>;
}

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: "document_idle",
  cssInjectionMode: "ui",
  async main(ctx) {
    if (window.top !== window) return; // top frame only
    primeAdapters();

    // Voice out (spec §7.1): the backend's Fish Audio voice ("Ethan"), fetched through the background
    // worker; the browser's own voice when that is unavailable or playback is blocked. The Settings
    // toggle lives in extension storage, so read it from there and follow changes.
    let voice = true;
    void browser.storage.local.get("glance:voice").then((r) => {
      voice = ((r as Record<string, string | undefined>)["glance:voice"] ?? "on") !== "off";
    });
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes["glance:voice"]) voice = (changes["glance:voice"].newValue ?? "on") !== "off";
    });
    // Scrolling and clicking for "show me": on unless turned off in Settings.
    let act = true;
    void browser.storage.local.get("glance:act").then((r) => {
      act = ((r as Record<string, string | undefined>)["glance:act"] ?? "on") !== "off";
    });
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes["glance:act"]) act = (changes["glance:act"].newValue ?? "on") !== "off";
    });
    // Voice in: on unless turned off in Settings.
    let talk = true;
    void browser.storage.local.get("glance:talk").then((r) => {
      talk = ((r as Record<string, string | undefined>)["glance:talk"] ?? "on") !== "off";
    });
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes["glance:talk"]) talk = (changes["glance:talk"].newValue ?? "on") !== "off";
    });
    let clip: HTMLAudioElement | null = null;
    let speakSeq = 0;
    /** Resolves the line playing now, when it has been heard or cut off. */
    let lineDone: (() => void) | null = null;
    const finishLine = () => {
      const done = lineDone;
      lineDone = null;
      bubble?.setSpeaking(false);
      done?.();
    };
    const speakLocal = (text: string, done: () => void) => {
      if (!("speechSynthesis" in window)) return done();
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1.05;
        u.onstart = () => bubble?.setSpeaking(true);
        u.onend = u.onerror = done;
        speechSynthesis.speak(u);
      } catch {
        done();
      }
    };
    /** Silence Glance, including a line still loading: when the user starts talking, and before a new line. */
    const stopSpeaking = () => {
      speakSeq++;
      clip?.pause();
      clip = null;
      try {
        speechSynthesis?.cancel();
      } catch {
        /* ignore */
      }
      finishLine();
    };
    /** Say a line. Resolves once it has been heard, cut off by a newer line, or at once when the voice is off. */
    const speak = (text: string): Promise<void> => {
      stopSpeaking();
      if (!voice) return Promise.resolve();
      const seq = speakSeq;
      return new Promise<void>((resolve) => {
        lineDone = resolve;
        const done = () => seq === speakSeq && finishLine();
        void (async () => {
          const res = await send({ type: "tts", text }).catch(() => null);
          if (seq !== speakSeq) return; // a newer line superseded this one while it loaded
          if (!res || !res.ok) {
            // Falling back is silent to the user, so say why here: a rejected line (too long for
            // TTS_MAX_CHARS) sounds exactly like a missing key unless someone looks.
            console.debug("[glance] the backend voice declined this line; using the browser's", { chars: text.length, code: res && "code" in res ? res.code : "offline" });
            return speakLocal(text, done);
          }
          const audio = new Audio(`data:${res.mime};base64,${res.audio}`);
          clip = audio;
          audio.addEventListener("playing", () => bubble?.setSpeaking(true));
          audio.addEventListener("ended", done);
          audio.addEventListener("error", done);
          try {
            await audio.play();
          } catch (e) {
            console.debug("[glance] audio playback blocked; using the local voice", e);
            speakLocal(text, done);
          }
        })();
      });
    };

    // ---- Passive mode: dictionary underlines, no network per page (spec §7.3) ----
    let matcher: Matcher | null = null;
    let companies: DictionaryCompany[] = [];
    let underliner: Underliner | null = null;
    try {
      const dict = (await send({ type: "dictionary" })) as Dictionary;
      companies = dict.companies;
      matcher = new Matcher(dict.companies);
      underliner = new Underliner(matcher);
      underliner.install();
    } catch (e) {
      console.debug("[glance] dictionary unavailable; passive mode off", e);
    }

    let bubble: Bubble | null = null;
    let sketch: Sketch | null = null;
    const rescan = () => {
      if (!underliner) return;
      const n = underliner.scan();
      bubble?.setHasEntities(n > 0);
    };
    let scanTimer: number | undefined;
    const scheduleScan = () => {
      window.clearTimeout(scanTimer);
      scanTimer = window.setTimeout(rescan, 300); // MutationObserver debounce per spec
    };
    const mo = new MutationObserver(scheduleScan);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    ctx.onInvalidated(() => mo.disconnect());

    // ---- The bubble ----
    const ui = await createShadowRootUi(ctx, {
      name: "glance-bubble",
      position: "overlay",
      anchor: "body",
      zIndex: 2147483000,
      isolateEvents: ["keydown", "keyup", "keypress", "wheel"],
      onMount(container, shadow) {
        const b = new Bubble(container, {
          onGlance: () => void glance(),
          onBuy: async (e, amount) => {
            const res = await send({ type: "buy", outputMint: e.mint!, usdcAmount: amount, context: pendingNote && lastContext ? { ...lastContext, note: pendingNote } : lastContext });
            if (res.ok) pendingNote = null;
            return res;
          },
          onWhy: (e) => send({ type: "why", ticker: e.ticker }),
          onCounterView: (e) => send({ type: "counter-view", ticker: e.ticker }),
          onWatch: (e) => send({ type: "watch", companyId: e.companyId }),
          onOpenPanel: () => void send({ type: "open-side-panel" }),
          // Every company card, however it was opened, gets the day's chart under its headline.
          onPick: (e) => void drawChart(e),
          speak,
          onListenStart: () => startListening("orb"),
          onListenStop: () => void stopListening(),
          onExplainEnd: () => {
            explainRun++;
            sketch?.clear();
            stopSpeaking();
          },
          onClearSketch: () => sketch?.clear(),
          onSell: (h, amount) => send({ type: "sell", ticker: h.ticker, ...("all" in amount ? { stockAmountRaw: h.sharesRaw } : { usd: amount.usd }), context: { url: location.href, title: document.title } }),
          onRemember: () => remember(),
        });
        mountMiniCard(shadow, b);
        sketch = new Sketch(container, () => b.occupiedRects());
        return b;
      },
      onRemove: () => {
        underliner?.uninstall();
      },
    });
    ui.mount();
    bubble = ui.mounted ?? null;
    rescan();

    // ---- Active mode (spec §7.3): hotkey ⌥G, bubble click, or the extension command ----
    let lastContext: GlanceEntity extends never ? never : ReturnType<typeof collectContext>["context"] = undefined;
    /** A spoken "note: …" said on the buy card, saved with the next buy (spec §7.5 step 7). */
    let pendingNote: string | null = null;
    let busy = false;
    /** Read the page and show its company. `focus`: a company id the user hovered and asked about, which leads. */
    async function glance(focus?: string) {
      if (!bubble || busy) return;
      busy = true;
      pendingNote = null;
      try {
        bubble.thinking();
        const input = { ...collectContext(), ...(focus ? { focus } : {}) };
        lastContext = input.context;
        let res: GlanceResult | ApiError;
        if (!input.text || input.text.length < 10) {
          // Fallback path (spec §7.3): no DOM text → a screenshot of the visible tab goes to the vision route.
          res = await glanceFromScreenshot(input);
        } else {
          res = await send({ type: "glance", input });
          if (res.ok && res.verdict === "none") {
            // The text had no company; the pixels might (a headline in an image, a canvas page).
            const shot = await glanceFromScreenshot(input);
            if (shot.ok && shot.verdict !== "none") res = shot;
          }
        }
        if (res.ok) {
          if (res.screenshotHash && lastContext) lastContext = { ...lastContext, screenshotHash: res.screenshotHash };
          bubble.showResult(res);
          void send({ type: "glance-happened" });
        } else if (res.code === "AUTH_INVALID" || res.code === "OFFLINE") {
          bubble.showError(res.code === "OFFLINE" ? res.message : "Sign in to Glance to get started.", { retry: false });
          if (res.code === "AUTH_INVALID") void send({ type: "open-side-panel" });
        } else {
          bubble.showError(res.message);
        }
      } catch (e) {
        console.debug("[glance] glance failed", e);
        bubble.showError(OFFLINE);
      } finally {
        busy = false;
      }
    }

    /**
     * Vision fallback (spec §7.3, §7.9): only ever after ⌥G or a bubble press, only when the DOM gave
     * nothing usable. The bubble hides itself for the capture; the backend hashes and discards the image.
     * `captureVisibleTab` rests on the `<all_urls>` host permission; if it still fails (a browser page),
     * this fails closed with the "couldn't read anything" line. The capture is at device pixels (twice
     * the width on a Retina screen) and images are billed by area, so it is scaled to at most 1280 px
     * wide first, like "show me"; that is plenty to read a headline.
     */
    async function glanceFromScreenshot(input: GlanceInput): Promise<GlanceResult | ApiError> {
      bubble!.thinking("Looking at the page…");
      const shot = await bubble!.withHidden(() => send({ type: "capture-visible-tab" }));
      if (!shot.ok) {
        console.debug("[glance] screenshot unavailable", shot);
        return { ok: false, code: "NO_SCREENSHOT", message: "I couldn't read anything on this page yet. Scroll to the story and try again?" };
      }
      const vw = window.innerWidth;
      const w = Math.min(MAP_MAX_WIDTH, vw);
      const image = vw > 0 ? await shrinkScreenshot(shot.dataUrl, { w, h: Math.round(window.innerHeight * (w / vw)) }).catch(() => shot.dataUrl) : shot.dataUrl;
      return send({ type: "glance-vision", input: { url: input.url, title: input.title, site: input.site, publishedAt: input.publishedAt, image } });
    }

    // ---- "Remember this page": a short fact sheet kept in this browser, for "show me" on other pages ----
    let remembering = false;
    async function remember(): Promise<boolean> {
      if (!bubble || remembering) return false;
      remembering = true;
      try {
        const page = collectContext();
        const text = readableText();
        if (text.length < 80) {
          bubble.reply("There isn't enough text here to remember. Scroll to the story and try again?");
          return false;
        }
        bubble.status("Reading the page to remember it…");
        const res = await send({ type: "remember", input: { url: page.url, title: page.title, site: page.site, publishedAt: page.publishedAt, text } });
        if (!res.ok) {
          bubble.reply(res.code === "AUTH_INVALID" ? "Sign in to Glance to get started." : res.code === "OFFLINE" ? OFFLINE : res.message);
          return false;
        }
        const note = await keepNote(res.note);
        const names = note.companies.slice(0, 2).map((c) => c.name);
        bubble.reply(`Got it. I'll remember this page${names.length ? ` about ${names.join(" and ")}` : ""}. Ask me about it on any other page.`);
        return true;
      } catch (e) {
        console.debug("[glance] remember failed", e);
        bubble.reply(OFFLINE);
        return false;
      } finally {
        remembering = false;
      }
    }

    /** Remembered pages that fit this question: about a company here or one it names, or asked for ("the article I saved"). */
    async function relevantMemory(question: string): Promise<ExplainMemory[]> {
      const notes = await loadNotes();
      if (!notes.length) return [];
      const page = collectContext();
      const ids = new Set<string>();
      if (bubble?.entity) ids.add(bubble.entity.companyId);
      if (matcher) for (const h of matcher.hits(`${page.title ?? ""}\n${page.text}`)) ids.add(h.company.id);
      return pickNotes(notes, { url: page.url, companyIds: [...ids], question }).map(toExplainMemory);
    }

    // ---- "Show me": a spoken question about the page, answered out loud while Glance draws on it ----
    let explainRun = 0;
    /** Time to read a line when the voice is off, so the drawings still keep pace. */
    const readingMs = (text: string) => Math.min(12_000, 700 + text.split(/\s+/).length * 330);

    /** Scrolls or clicks one answer may take before Glance stops and lets the user drive. */
    const MAX_STEPS = 4;
    /** Between saying "I'll click this" and clicking: time to see the ring, and to press Escape. */
    const CLICK_GRACE_MS = 1200;
    const say = (text: string) => (voice ? speak(text) : new Promise<void>((r) => window.setTimeout(r, readingMs(text))));

    /** Wait out the grace period; false if the user cancelled (Escape, a new take, or closing the card). */
    function grace(run: number, ms: number): Promise<boolean> {
      return new Promise((resolve) => {
        const onKey = (ev: KeyboardEvent) => {
          if (ev.key !== "Escape") return;
          explainRun++;
          finish();
        };
        const timer = window.setTimeout(finish, ms);
        window.addEventListener("keydown", onKey, true);
        function finish() {
          window.clearTimeout(timer);
          window.removeEventListener("keydown", onKey, true);
          resolve(run === explainRun);
        }
      });
    }

    /**
     * Take the step the model asked for. Returns how it went, for the next look, or null when the
     * answer should stop here (cancelled, or the page is being left).
     */
    async function takeStep(a: ExplainAction, map: PageMap, run: number): Promise<ExplainStep["action"] | null> {
      const node = a.element ? map.nodes.get(a.element) : undefined;
      const base = { kind: a.kind as "scroll" | "click", target: node ? labelOf(node) || null : null, direction: a.direction };
      if (!act) {
        const line = "Scrolling and clicking are turned off in Settings, so I'll stop here.";
        bubble!.explainStatus(line);
        await say(line);
        return null;
      }
      if (a.kind === "scroll") {
        bubble!.explainStatus(base.target ? `Scrolling to “${base.target}”…` : `Scrolling ${a.direction}…`);
        bubble!.explainWorking("working");
        if (node?.isConnected) await scrollToElement(node);
        else if (a.direction) await scrollScreen(a.direction);
        else return { ...base, outcome: "failed" };
        return { ...base, outcome: "done" };
      }
      const target = node?.isConnected ? clickTarget(node) : null;
      if (!target) return { ...base, outcome: "failed" };
      const label = labelOf(target) || base.target || "that";
      const no = refusal(target);
      if (no) {
        const line = `I won't click “${label}”: ${no} You can click it yourself.`;
        bubble!.explainStatus(line);
        await say(line);
        return null;
      }
      if (!inView(target)) await scrollToElement(target);
      bubble!.explainStatus(`Clicking “${label}”… (Esc to stop)`);
      bubble!.explainWorking("connecting");
      sketch!.draw({ kind: "circle", element: a.element, quote: null, box: null, points: null, text: null }, map, 0);
      if (!(await grace(run, CLICK_GRACE_MS))) {
        bubble!.explainWorking(null);
        bubble!.explainStatus("Stopped. Nothing was clicked.");
        return null;
      }
      const r = target.getBoundingClientRect();
      sketch!.tap(r.left + r.width / 2, r.top + r.height / 2);
      const href = newTabHref(target);
      if (href) {
        await send({ type: "open-tab", url: href });
        bubble!.explainStatus("Opened it in a new tab.");
        return null;
      }
      const changed = await clickLikeAPerson(target);
      return { ...base, target: label, outcome: changed ? "done" : "failed" };
    }

    /**
     * Point at something off screen: scroll the first marked element that isn't in view into view before
     * the segment's marks are drawn, so "point me to X" scrolls, then points. Marks follow the page, and
     * pixel marks are pinned to where the screenshot was, so the rest still land. Off in Settings, it stays put.
     */
    async function reveal(marks: SketchMark[], map: PageMap) {
      if (!act) return;
      const node = marks.map((m) => (m.element ? map.nodes.get(m.element) : undefined)).find((n): n is Element => !!n && n.isConnected && !inView(n));
      if (node) await scrollToElement(node);
    }

    async function explain(question: string) {
      if (!bubble || !sketch) return;
      // Replacing an explanation card ends that explanation (onExplainEnd), so take the run number after.
      bubble.thinking("Looking at the page…");
      sketch.clear(true);
      stopSpeaking();
      const run = ++explainRun;
      const history: ExplainStep[] = [];
      let shown = false;
      // Words the question names ("point me to Anthropic"), so the map includes their mentions far down the page.
      const terms = questionTerms(question);
      try {
        const memory = await relevantMemory(question).catch(() => []);
        for (let step = 0; step <= MAX_STEPS; step++) {
          if (step > 0) {
            bubble.explainStatus("Looking again…");
            bubble.explainWorking("searching");
            sketch.clear(true);
          }
          const map = mapPage(terms);
          // The same shot the page shows, without the bubble; its pixels and the map's boxes share one space.
          const shot = await bubble.withHidden(() => send({ type: "capture-visible-tab" })).catch(() => null);
          const image = shot?.ok ? await shrinkScreenshot(shot.dataUrl, map.size).catch(() => undefined) : undefined;
          if (run !== explainRun) return;
          if (shown) bubble.explainWorking("solving");
          else bubble.thinking("Working it out…", "solving");
          const input = { question, url: location.href, title: document.title, size: map.size, image, elements: map.elements, history, stepsLeft: MAX_STEPS - step, memory };
          const res = await send({ type: "explain", input });
          if (run !== explainRun) return;
          if (!res.ok) {
            const line = res.code === "OFFLINE" ? OFFLINE : res.message;
            if (shown) bubble.explainStatus(line);
            else bubble.showError(line, { retry: false });
            void speak(res.message);
            return;
          }
          // Voice the later lines ahead of time so the explanation runs without gaps.
          if (voice) for (const seg of res.segments.slice(1)) void send({ type: "tts", text: seg.say }).catch(() => null);
          const lines = res.segments.map((seg) => seg.say);
          let first = 0;
          if (shown) {
            bubble.explainWorking(null);
            bubble.explainStatus(null);
            first = bubble.explainAppend(lines);
          } else {
            bubble.showExplanation(question, lines, res.skills);
            shown = true;
          }
          for (const [i, seg] of res.segments.entries()) {
            if (run !== explainRun) return;
            bubble.explainStep(first + i);
            await reveal(seg.marks, map);
            if (run !== explainRun) return;
            seg.marks.forEach((m, j) => sketch!.draw(m, map, j * 450, res.chart));
            await say(seg.say);
          }
          if (run !== explainRun || res.action.kind === "none") break;
          const done = await takeStep(res.action, map, run);
          if (!done || run !== explainRun) {
            if (run === explainRun) bubble.explainWorking(null);
            return;
          }
          history.push({ said: lines, action: done });
        }
        if (run === explainRun) bubble.explainDone();
      } catch (e) {
        console.debug("[glance] explain failed", e);
        if (run === explainRun) bubble.showError(OFFLINE, { retry: false });
      }
    }

    // ---- The vault by voice: cash, today's limit, holdings, and selling (which always asks first) ----

    const nameOf = (companyId: string | null) => companies.find((c) => c.id === companyId) ?? null;

    async function account(kind: "balance" | "limit" | "holdings", companyId: string | null) {
      if (!bubble) return;
      const [session, portfolio] = await Promise.all([send({ type: "session" }), kind === "limit" ? null : send({ type: "portfolio" })]);
      const failed = [session, portfolio].find((r) => r && !r.ok);
      if (failed && !failed.ok) {
        bubble.reply(failed.code === "AUTH_INVALID" ? "Sign in to Glance to get started." : failed.message);
        return;
      }
      if (!session.ok) return;
      if (session.needsAccount) {
        bubble.reply("You don't have a Glance account yet. Open Glance to create one.");
        return;
      }
      if (kind === "limit") {
        const line = session.paused
          ? "Glance is paused, so it won't spend anything until you resume it."
          : `You can spend ${usd(session.remainingTodayUsd)} more today, of your ${usd(session.dailyCapUsd)} daily limit. It resets on a rolling twenty-four hours.`;
        bubble.reply(line);
        return;
      }
      if (!portfolio || !portfolio.ok) return;
      const stocks = portfolio.holdings.reduce((n, h) => n + (h.valueUsd ?? 0), 0);
      if (kind === "balance") {
        bubble.reply(`You have ${usd(portfolio.cashUsd)} in cash and ${usd(stocks)} in stocks, ${usd(portfolio.cashUsd + stocks)} in all.`);
        return;
      }
      const named = nameOf(companyId);
      if (named) {
        const h = portfolio.holdings.find((x) => x.ticker === named.ticker);
        const change = h?.dayChangePct != null ? `, ${h.dayChangePct >= 0 ? "up" : "down"} ${Math.abs(h.dayChangePct).toFixed(1)} percent today` : "";
        bubble.reply(h ? `You own ${usd(h.valueUsd)} of ${h.name}, ${h.shares.toPrecision(3)} shares${change}.` : `You don't own any ${named.name}.`);
        return;
      }
      if (!portfolio.holdings.length) {
        bubble.reply(`You don't own any stocks yet. You have ${usd(portfolio.cashUsd)} in cash.`);
        return;
      }
      const top = [...portfolio.holdings].sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
      const list = top.slice(0, 3).map((h) => `${h.name} at ${usd(h.valueUsd)}`);
      const more = top.length > 3 ? `, and ${top.length - 3} more` : "";
      bubble.reply(`You own ${list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list[0]}${more}. That's ${usd(stocks)} in stocks.`);
    }

    /** How long a stock answer waits for the portfolio before speaking without "and you own some". */
    const OWNED_BUDGET_MS = 400;

    /**
     * The day chart under any company card: a glance, a pick from the choice chips, the underline's
     * "Glance this", or a spoken question. Asked for after the card is already up, so nothing waits
     * on Birdeye, and only drawn while that company is still the one on screen. An empty answer (no
     * Birdeye key, or a token it doesn't know) leaves the card exactly as it was.
     */
    let chartRun = 0;
    async function drawChart(e: GlanceEntity, market: TokenMarket | null = null) {
      if (!bubble || !e.tokenized) return;
      if (market) bubble.showChart([], market);
      const mint = e.listings?.[0]?.mint ?? e.mint;
      if (!mint) return;
      const run = ++chartRun;
      const h = await send({ type: "company-history", mint }).catch(() => null);
      if (!h?.ok || run !== chartRun || bubble?.entity?.companyId !== e.companyId) return;
      // A host that answers without the fields (an older background, the preview shim) must not throw.
      const points = h.points ?? [];
      if (points.length || h.market) bubble.showChart(points, h.market ?? market);
    }

    /**
     * A spoken question about a company (voice kind `stock`): "how's Nvidia doing?". The price and the
     * day's move come from /company in about a third of a second; what the user owns is only added when
     * the vault answers inside the budget, so the line never waits on the chain.
     */
    async function stock(companyId: string) {
      if (!bubble) return;
      const named = nameOf(companyId);
      bubble.thinking(named ? `Checking ${named.name}…` : "Checking the price…", "working");
      const owned = send({ type: "portfolio" }).catch(() => null);
      const res = await send({ type: "company", companyId }).catch((): ApiError => ({ ok: false, code: "OFFLINE", message: OFFLINE }));
      if (!bubble) return;
      if (!res.ok) {
        bubble.reply(res.code === "AUTH_INVALID" ? "Sign in to Glance to get started." : res.message);
        return;
      }
      let line = res.summary;
      if (res.entity.tokenized) {
        const portfolio = await Promise.race([owned, new Promise<null>((r) => window.setTimeout(() => r(null), OWNED_BUDGET_MS))]);
        const held = portfolio?.ok ? portfolio.holdings.find((h) => h.ticker === res.entity.ticker) : undefined;
        if (held?.valueUsd) line = `${line} You own ${usd(held.valueUsd)} of it.`;
      }
      // showEntity only draws the card, unlike showResult, so the answer is said here.
      bubble.showEntity(res.entity, line);
      void speak(line);
      // showEntity's onPick has already asked for the chart; this hands over the numbers the spoken
      // line used, so the card shows them at once instead of waiting for that second call.
      if (res.market) bubble.showChart([], res.market);
    }

    /**
     * "What do you think of Nvidia?" (voice kind `advice`): the company's card, then Glance's read of
     * it — what's happening, both sides, what to watch — said out loud and shown, ending with the
     * disclaimer the backend writes. It takes a few seconds, so the orb works while it thinks.
     */
    let adviceRun = 0;
    async function advice(companyId: string) {
      if (!bubble) return;
      const named = nameOf(companyId);
      bubble.thinking(named ? `Reading up on ${named.name}…` : "Reading up on it…", "working");
      const res = await send({ type: "advice", companyId }).catch((): ApiError => ({ ok: false, code: "OFFLINE", message: OFFLINE }));
      if (!bubble) return;
      if (!res.ok) {
        bubble.reply(res.code === "AUTH_INVALID" ? "Sign in to Glance to get started." : res.message);
        return;
      }
      // An untokenized company has no read: the card says so itself.
      bubble.showEntity(res.entity, res.lines.length ? res.lines[0] : res.summary);
      if (res.market) bubble.showChart([], res.market);
      bubble.showRead(res.lines, res.disclaimer);
      // One clip per line, said in order: a whole read is past the backend's limit for a single
      // line, and speak() falls back to the browser's voice on any failure. Short clips also start
      // sooner. A new take stops the run, because speak() cancels whatever was playing.
      void (async () => {
        const run = ++adviceRun;
        for (const line of res.spokenLines.length ? res.spokenLines : [res.spoken]) {
          if (run !== adviceRun) return;
          await speak(line);
        }
      })();
    }

    async function sellByVoice(companyId: string | null, amountUsd: number | null, all: boolean) {
      if (!bubble) return;
      const named = nameOf(companyId);
      if (!named) {
        bubble.reply("Which stock should I sell? Say its name.");
        return;
      }
      const portfolio = await send({ type: "portfolio" });
      if (!portfolio.ok) {
        bubble.reply(portfolio.code === "AUTH_INVALID" ? "Sign in to Glance to get started." : portfolio.message);
        return;
      }
      const h = portfolio.holdings.find((x) => x.ticker === named.ticker);
      if (!h || !h.valueUsd) {
        bubble.reply(`You don't own any ${named.name}.`);
        return;
      }
      bubble.showSell(h, all ? { all: true } : { usd: amountUsd ?? (Math.min(10, Math.floor(h.valueUsd)) || h.valueUsd) });
    }

    /** "Scroll down", "back to the top": no model needed. */
    async function scrollPage(direction: "up" | "down" | "top" | "bottom") {
      if (!act) {
        bubble?.reply("Scrolling and clicking are turned off in Settings.");
        return;
      }
      await scrollScreen(direction);
      if (bubble?.view === "closed") bubble.stopListening();
    }

    window.addEventListener(
      "keydown",
      (ev) => {
        if (ev.altKey && !ev.ctrlKey && !ev.metaKey && (ev.code === "KeyG" || ev.key.toLowerCase() === "g" || ev.key === "©")) {
          ev.preventDefault();
          void glance();
        }
      },
      true,
    );
    browser.runtime.onMessage.addListener((msg: TabMessage) => {
      if (msg?.type === "trigger-glance") {
        // ⌥G came from the command API: they know the hotkeys, so stop offering them.
        void Bubble.learnedHotkeys();
        void glance();
      }
    });

    // ---- Voice in (spec §7.4): hold ⌥V, or hold the orb, say it, let go ----
    // The recorder is an offscreen document owned by the extension: the page never sees the
    // microphone or a permission prompt, and nothing is recorded outside a hold.
    let take: { from: "key" | "orb"; at: number; started: Promise<BgResponse<"listen-start">>; limit: number } | null = null;

    function startListening(from: "key" | "orb"): boolean {
      if (!bubble || !talk) return false;
      if (take) return true;
      explainRun++;
      stopSpeaking();
      // The most common thing said over a company card is "why did it move?", and that answer takes
      // seconds to build. Start it now, while they speak, so it is waiting when they finish.
      const onCard = bubble.entity;
      if (onCard?.tokenized && onCard.ticker) void send({ type: "warm-why", ticker: onCard.ticker }).catch(() => null);
      bubble.listening();
      const started = send({ type: "listen-start" }).catch((): ApiError => ({ ok: false, code: "OFFLINE", message: OFFLINE }));
      const t = { from, at: Date.now(), started, limit: window.setTimeout(() => void stopListening(), MAX_TALK_MS) };
      take = t;
      void started.then((r) => {
        if (r.ok || !bubble) return;
        if (take === t) {
          window.clearTimeout(t.limit);
          take = null;
        }
        if (r.code === "MIC_PERMISSION") bubble.showError(r.message, { action: { label: "Allow microphone", run: () => void send({ type: "open-mic-setup" }) } });
        else bubble.showError(r.message, { retry: false });
        speak(r.message);
      });
      return true;
    }

    async function stopListening(drop = false) {
      const t = take;
      if (!t || !bubble) return;
      take = null;
      window.clearTimeout(t.limit);
      if (!(await t.started).ok) return; // already explained
      if (drop || Date.now() - t.at < MIN_TALK_MS) {
        void send({ type: "listen-cancel" });
        if (drop) bubble.stopListening();
        else bubble.reply(t.from === "key" ? "Keep holding ⌥V while you talk, then let go." : "Keep holding the dot while you talk, then let go.");
        return;
      }
      bubble.hearing();
      await new Promise((r) => window.setTimeout(r, TALK_TAIL_MS));
      const before = bubble.voiceContext();
      const res = await send({ type: "listen-stop", context: before }).catch((): ApiError => ({ ok: false, code: "OFFLINE", message: OFFLINE }));
      if (!res.ok) {
        if (res.code === "AUTH_INVALID") {
          bubble.showError("Sign in to Glance to get started.", { retry: false });
          void send({ type: "open-side-panel" });
        } else bubble.reply(res.message);
        return;
      }
      if (!res.transcript) {
        bubble.reply("I didn't hear anything. Try again a little closer to the microphone?");
        return;
      }
      bubble.heard(res.transcript);
      await runCommand(res.command, before, {
        bubble,
        glance,
        saveNote: async (id, note) => (await send({ type: "journal-note", id, note }).catch(() => null))?.ok === true,
        keepNote: (note) => (pendingNote = note),
        explain: () => explain(res.transcript),
        scroll: scrollPage,
        account,
        stock,
        advice,
        sell: sellByVoice,
        remember: async () => void (await remember()),
      });
      bubble.echoHeard(res.transcript);
    }

    window.addEventListener(
      "keydown",
      (ev) => {
        if (ev.code !== TALK_CODE || !ev.altKey || ev.ctrlKey || ev.metaKey || !talk) return;
        ev.preventDefault(); // ⌥V types "√" on a Mac
        if (!ev.repeat) {
          void Bubble.learnedHotkeys();
          startListening("key");
        }
      },
      true,
    );
    window.addEventListener(
      "keyup",
      (ev) => {
        if (take?.from !== "key" || (ev.code !== TALK_CODE && ev.key !== "Alt")) return;
        ev.preventDefault();
        void stopListening();
      },
      true,
    );
    // Focus left mid-hold, so the key release will never arrive here: drop the take rather than send half a sentence.
    window.addEventListener("blur", () => void stopListening(true));
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) void stopListening(true);
    });

    // ---- Hover mini-card over passive underlines ----
    function mountMiniCard(shadow: ShadowRoot, b: Bubble) {
      const mini = document.createElement("div");
      mini.className = "mini";
      mini.hidden = true;
      shadow.querySelector(".root")?.before(mini);
      const priceCache = new Map<string, { at: number; row: PriceRow }>();
      let current: string | null = null;
      let hideTimer: number | undefined;
      // Moving from the word to the card crosses a small gap and often other underlined text under the
      // card. While the pointer is on the card it stays put: no countdown, and no switching to whatever is
      // underlined beneath it. Leaving the word or the card starts a short countdown, reset by each move.
      let overMini = false;
      const HIDE_MS = 400;
      const scheduleHide = () => {
        window.clearTimeout(hideTimer);
        hideTimer = window.setTimeout(() => {
          if (!overMini) mini.hidden = true;
        }, HIDE_MS);
      };
      mini.addEventListener("pointerenter", () => {
        overMini = true;
        window.clearTimeout(hideTimer);
      });
      mini.addEventListener("pointerleave", () => {
        overMini = false;
        scheduleHide();
      });
      const show = async (x: number, y: number) => {
        if (overMini) return;
        const u = underliner?.at(x, y);
        if (!u) {
          if (!mini.hidden) scheduleHide();
          return;
        }
        window.clearTimeout(hideTimer);
        if (current !== u.company.id || mini.hidden) {
          current = u.company.id;
          mini.hidden = false;
          mini.innerHTML = `<strong>${u.company.name}</strong><span class="price">…</span>`;
          const cached = priceCache.get(u.company.ticker);
          let row = cached && Date.now() - cached.at < 30_000 ? cached.row : null;
          if (!row) {
            const res = await send({ type: "prices", tickers: [u.company.ticker] });
            row = res.ok ? (res.prices[0] ?? null) : null;
            if (row) priceCache.set(u.company.ticker, { at: Date.now(), row });
          }
          if (current !== u.company.id) return;
          const price = row?.priceUsd != null ? `$${row.priceUsd >= 100 ? row.priceUsd.toFixed(0) : row.priceUsd.toFixed(2)}` : "";
          // Whether it trades comes from the price row when there is one, else from the dictionary: a failed
          // price lookup (signed out, backend busy) must not read as "not on-chain".
          const onChain = row ? row.tokenized : u.company.tokenized;
          mini.innerHTML = `<strong>${u.company.name}</strong>${
            onChain ? `${price ? `<span class="price">${price}</span>` : ""}<button class="go" type="button">Glance this</button>` : `<span class="delta">Not on-chain yet</span>`
          }`;
          // Glance this company, not whatever the page is mainly about.
          mini.querySelector(".go")?.addEventListener("click", () => {
            mini.hidden = true;
            overMini = false;
            void glance(u.company.id);
          });
        }
        const rect = u.range.getBoundingClientRect();
        const w = mini.offsetWidth || 220;
        mini.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, rect.left))}px`;
        mini.style.top = `${rect.bottom + 4 + mini.offsetHeight > window.innerHeight ? rect.top - mini.offsetHeight - 4 : rect.bottom + 4}px`;
      };
      let raf = 0;
      window.addEventListener(
        "mousemove",
        (ev) => {
          if (raf) return;
          raf = requestAnimationFrame(() => {
            raf = 0;
            void show(ev.clientX, ev.clientY);
          });
        },
        { passive: true },
      );
      void b;
    }
  },
});
