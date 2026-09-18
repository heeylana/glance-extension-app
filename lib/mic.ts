/**
 * Microphone permission for push-to-talk (spec §7.1: asked once, from Glance's own page, never from
 * injected content). The grant belongs to the extension's origin, so any extension page can read it,
 * and the offscreen recorder inherits it.
 */
import { browser } from "wxt/browser";

export type MicState = "granted" | "denied" | "prompt";

export async function micPermission(): Promise<MicState> {
  try {
    return (await navigator.permissions.query({ name: "microphone" as PermissionName })).state;
  } catch {
    return "prompt";
  }
}

/** Follow the permission as the user changes it in the prompt or in site settings. */
export function watchMicPermission(onChange: (s: MicState) => void): () => void {
  let status: PermissionStatus | null = null;
  const handler = () => status && onChange(status.state);
  void navigator.permissions
    .query({ name: "microphone" as PermissionName })
    .then((s) => {
      status = s;
      s.addEventListener("change", handler);
      onChange(s.state);
    })
    .catch(() => onChange("prompt"));
  return () => status?.removeEventListener("change", handler);
}

export function openMicSetup() {
  const getURL = browser.runtime.getURL as unknown as (path: string) => string; // unlisted pages are typed only after `wxt prepare`
  return browser.tabs.create({ url: getURL("/mic.html") });
}
