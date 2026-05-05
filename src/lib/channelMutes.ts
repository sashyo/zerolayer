"use client";

/**
 * Channel mute store — purely client-side. Muted channels still receive
 * messages and still flip the unread dot in the sidebar (so you know they
 * have activity), but they DO NOT fire browser notifications, audio pings,
 * or red mention badges.
 */
const KEY = "zl:mutedChannels";

function read(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function write(set: Set<string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(Array.from(set)));
  } catch {}
}

export function isChannelMuted(channelId: string): boolean {
  return read().has(channelId);
}

export function toggleChannelMute(channelId: string): boolean {
  const set = read();
  if (set.has(channelId)) set.delete(channelId);
  else set.add(channelId);
  write(set);
  // Notify listeners — same-tab `storage` events don't fire so we dispatch
  // our own, and the cross-tab case is covered by the native event.
  window.dispatchEvent(new Event("zl:mutes-changed"));
  return set.has(channelId);
}

export function getMutedChannels(): Set<string> {
  return read();
}
