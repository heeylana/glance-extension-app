/**
 * The orb inside the floating bubble: `thinking-orbs` (Jakub Antalik, MIT) through its React-free
 * engine, painted on a plain canvas. Breathing is the resting state; the bubble switches to
 * listening, searching, solving, connecting, working or composing while Glance is busy. A change
 * of state crossfades, the loop stops while the tab is hidden, idle breathing is capped at 30 fps,
 * and reduced motion gets one still frame.
 */
import { MODE_FRAMES, paintFrame, resolvePreset, type OrbState } from "thinking-orbs/engine";

export type { OrbState };

/** The 64 px preset is the avatar-scale design; the canvas shows it at `cssSize`. */
const PRESET = 64;
const CROSSFADE_S = 0.28;
const IDLE_FRAME_MS = 1000 / 30;

type Resolved = ReturnType<typeof resolvePreset>;

export class Orb {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private dpr = Math.min(2, window.devicePixelRatio || 1);
  private current: { state: OrbState; preset: Resolved };
  private previous: { state: OrbState; preset: Resolved; until: number } | null = null;
  private raf = 0;
  private lastPaint = 0;
  private reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  constructor(cssSize: number) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "orb";
    this.canvas.setAttribute("aria-hidden", "true");
    this.canvas.style.width = this.canvas.style.height = `${cssSize}px`;
    this.canvas.width = this.canvas.height = Math.round(cssSize * this.dpr);
    this.ctx = this.canvas.getContext("2d");
    this.current = { state: "breathing", preset: resolvePreset("breathing", PRESET) };
    document.addEventListener("visibilitychange", () => (document.hidden ? this.stop() : this.start()));
    this.reduced.addEventListener("change", () => this.start());
    this.start();
  }

  get state(): OrbState {
    return this.current.state;
  }

  set(state: OrbState) {
    if (state === this.current.state) return;
    const now = performance.now() / 1000;
    this.previous = { ...this.current, until: now + CROSSFADE_S };
    this.current = { state, preset: resolvePreset(state, PRESET) };
    if (this.reduced.matches) this.paint(0.6, 1);
    else this.start();
  }

  private start() {
    if (this.raf || document.hidden) return;
    if (this.reduced.matches) {
      this.paint(0.6, 1);
      return;
    }
    const loop = (ms: number) => {
      this.raf = requestAnimationFrame(loop);
      // Resting breath is slow; half the frame rate is indistinguishable and half the work on every open page.
      if (this.current.state === "breathing" && !this.previous && ms - this.lastPaint < IDLE_FRAME_MS) return;
      this.lastPaint = ms;
      this.paint(ms / 1000, null);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** `fixedT` for the reduced-motion still; otherwise the shared clock drives both layers of a crossfade. */
  private paint(tSec: number, fixedMix: number | null) {
    const ctx = this.ctx;
    if (!ctx) return;
    const scale = (this.canvas.width / PRESET);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, PRESET, PRESET);
    const prev = this.previous;
    const mix = fixedMix ?? (prev ? Math.max(0, Math.min(1, 1 - (prev.until - tSec) / CROSSFADE_S)) : 1);
    if (prev && mix < 1) {
      ctx.globalAlpha = 1 - mix;
      this.layer(ctx, prev.preset, tSec);
    } else this.previous = null;
    ctx.globalAlpha = mix;
    this.layer(ctx, this.current.preset, tSec);
    ctx.globalAlpha = 1;
  }

  private layer(ctx: CanvasRenderingContext2D, p: Resolved, tSec: number) {
    // dark = light ink, for the bubble's dark glass.
    paintFrame(ctx, MODE_FRAMES[p.mode](PRESET, tSec * p.speed, p.opts), true);
  }
}
