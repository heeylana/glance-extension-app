/**
 * The push-to-talk recorder (spec §7.4): an offscreen document, so the microphone belongs to the
 * extension and never to the site being read. The permission is granted once on mic.html (an
 * offscreen document cannot show a prompt) and this page inherits it. It records only between the
 * background's start and stop, releases the microphone straight after, and hands back 16 kHz mono WAV.
 *
 * It also plays Glance's voice. Played inside the page, a clip was blocked on any site whose CSP has
 * no data: in media-src (or that refused autoplay), and every line fell back to the browser's voice.
 */
import { browser } from "wxt/browser";
import { concat, downsample, encodeWav, peak, SPEECH_RATE, toBase64 } from "../../lib/audio";
import type { RecorderRequest, RecorderStart, RecorderTake } from "../../lib/messages";

const MAX_SECONDS = 30;

// Chromium's MediaStreamTrackProcessor (mediacapture-transform) is not in the DOM typings.
interface AudioFrame {
  sampleRate: number;
  numberOfFrames: number;
  copyTo(dest: Float32Array, options: { planeIndex: number; format: "f32-planar" }): void;
  close(): void;
}
declare const MediaStreamTrackProcessor: new (init: { track: MediaStreamTrack }) => { readable: ReadableStream<AudioFrame> };

interface Take {
  stream: MediaStream;
  reader: ReadableStreamDefaultReader<AudioFrame>;
  chunks: Float32Array[];
  rate: number;
  pump: Promise<void>;
}
let take: Take | null = null;

async function start(): Promise<RecorderStart> {
  release();
  if (typeof MediaStreamTrackProcessor === "undefined") {
    return { ok: false, code: "VOICE_UNSUPPORTED", message: "Talking to Glance needs Chrome, Brave, Edge or Arc." };
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") return { ok: false, code: "MIC_PERMISSION", message: "I need your microphone once. Allow it, then hold ⌥V again." };
    return { ok: false, code: "MIC_UNAVAILABLE", message: "I can't find a microphone. Plug one in and try again?" };
  }
  const track = stream.getAudioTracks()[0]!;
  const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
  const t: Take = { stream, reader, chunks: [], rate: track.getSettings().sampleRate ?? 48_000, pump: Promise.resolve() };
  t.pump = (async () => {
    let frames = 0;
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
      if (done || !value) return;
      try {
        t.rate = value.sampleRate;
        const buf = new Float32Array(value.numberOfFrames);
        value.copyTo(buf, { planeIndex: 0, format: "f32-planar" });
        t.chunks.push(buf);
        frames += buf.length;
      } finally {
        value.close();
      }
      if (frames >= t.rate * MAX_SECONDS) return;
    }
  })();
  take = t;
  return { ok: true };
}

async function stop(): Promise<RecorderTake> {
  const t = take;
  take = null;
  if (!t) return { ok: false, code: "NOT_LISTENING", message: "I wasn't listening. Hold ⌥V while you talk." };
  await t.reader.cancel().catch(() => undefined);
  for (const tr of t.stream.getTracks()) tr.stop();
  await t.pump;
  const samples = downsample(concat(t.chunks), t.rate);
  return { ok: true, wav: `data:audio/wav;base64,${toBase64(encodeWav(samples))}`, seconds: samples.length / SPEECH_RATE, peak: peak(samples) };
}

/** Drop a take without sending it: the key was tapped, the tab lost focus, or a new take began. */
function release() {
  if (!take) return;
  void take.reader.cancel().catch(() => undefined);
  for (const tr of take.stream.getTracks()) tr.stop();
  take = null;
}

let playing: { audio: HTMLAudioElement; finish: (r: { ok: true; stopped?: boolean } | { ok: false; code: string; message: string }) => void } | null = null;

/** Stop the line playing now; its play() answers as stopped. */
function hush() {
  const p = playing;
  playing = null;
  if (!p) return;
  p.audio.pause();
  p.finish({ ok: true, stopped: true });
}

function play(src: string): Promise<{ ok: true; stopped?: boolean } | { ok: false; code: string; message: string }> {
  hush();
  return new Promise((resolve) => {
    const audio = new Audio(src);
    let settled = false;
    const finish: typeof resolve = (r) => {
      if (settled) return;
      settled = true;
      if (playing?.audio === audio) playing = null;
      resolve(r);
    };
    playing = { audio, finish };
    audio.addEventListener("ended", () => finish({ ok: true }));
    audio.addEventListener("error", () => finish({ ok: false, code: "PLAYBACK_FAILED", message: "The clip didn't play." }));
    audio.play().catch((e) => finish({ ok: false, code: "PLAYBACK_FAILED", message: String(e) }));
  });
}

browser.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
  const msg = raw as RecorderRequest | undefined;
  if (msg?.target !== "recorder") return false;
  if (msg.type === "play") {
    void play(`data:${msg.mime};base64,${msg.audio}`).then(sendResponse);
    return true;
  }
  if (msg.type === "hush") {
    hush();
    sendResponse({ ok: true });
    return false;
  }
  const run: Promise<RecorderStart | RecorderTake> = msg.type === "start" ? start() : msg.type === "stop" ? stop() : Promise.resolve((release(), { ok: true as const }));
  run.then(sendResponse, (e) => sendResponse({ ok: false, code: "RECORDER_ERROR", message: "I couldn't hear that. Try again?", detail: String(e) }));
  return true;
});
