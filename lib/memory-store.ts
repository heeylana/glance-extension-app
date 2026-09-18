/**
 * Remembered pages in chrome.storage.local (`glance:memory`), shared by the content script and the
 * side panel, never sent to the backend for storage. Rules for what is kept are in lib/memory.ts.
 */
import { browser } from "wxt/browser";
import type { PageNote } from "./api-types";
import { prune, upsert } from "./memory";

export const MEMORY_KEY = "glance:memory";

export async function loadNotes(): Promise<PageNote[]> {
  const r = (await browser.storage.local.get(MEMORY_KEY)) as Record<string, PageNote[] | undefined>;
  return prune(Array.isArray(r[MEMORY_KEY]) ? r[MEMORY_KEY]! : []);
}

export async function keepNote(draft: Omit<PageNote, "id">): Promise<PageNote> {
  const note: PageNote = { ...draft, id: crypto.randomUUID() };
  await browser.storage.local.set({ [MEMORY_KEY]: upsert(await loadNotes(), note) });
  return note;
}

export async function forgetNote(id: string): Promise<void> {
  await browser.storage.local.set({ [MEMORY_KEY]: (await loadNotes()).filter((n) => n.id !== id) });
}

export async function forgetAll(): Promise<void> {
  await browser.storage.local.remove(MEMORY_KEY);
}
