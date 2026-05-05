"use client";

/**
 * Tiny localStorage-backed bookmark store. Saving keeps the channel id and
 * decrypted plaintext at save time so the user can see what they bookmarked
 * even when E2EE keys are no longer present (e.g. they left the server).
 */
const KEY = "zl:savedMessages";

export interface SavedMessage {
  id: string;
  channelId: string;
  authorName: string;
  plaintext: string;
  savedAt: number;
}

function read(): SavedMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as SavedMessage[]) : [];
  } catch {
    return [];
  }
}

function write(list: SavedMessage[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
  window.dispatchEvent(new Event("zl:saved-changed"));
}

export function getSavedMessages(): SavedMessage[] {
  return read();
}

export function isMessageSaved(id: string): boolean {
  return read().some((m) => m.id === id);
}

export function toggleSaveMessage(entry: SavedMessage): boolean {
  const list = read();
  const idx = list.findIndex((m) => m.id === entry.id);
  if (idx >= 0) {
    list.splice(idx, 1);
    write(list);
    return false;
  }
  list.unshift({ ...entry, savedAt: Date.now() });
  // Cap the list so localStorage doesn't grow unbounded.
  if (list.length > 200) list.length = 200;
  write(list);
  return true;
}
