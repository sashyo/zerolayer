"use client";

/**
 * Voice roster singleton — one Supabase Realtime channel for the whole tab,
 * shared between useVoiceChannel (which announces our own join/leave) and
 * useVoiceRoster (which observes everyone else). Going through a singleton
 * sidesteps the supabase-js rule that `.on()` can't be called on a channel
 * that has already been subscribed: we only ever subscribe once per tab.
 *
 * Wire format: each entry presence-tracked under its sessionId carries
 * `{ channelId, userId }`. Listeners get a Map<channelId, Array<entry>>.
 */
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";

export interface RosterEntry {
  channelId: string;
  userId: string;
  sessionId: string;
}

const TOPIC = "voice-roster:v1";
const tabSessionId =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

let channel: RealtimeChannel | null = null;
let subscribePromise: Promise<RealtimeChannel> | null = null;
const listeners = new Set<() => void>();
let snapshot: Map<string, RosterEntry[]> = new Map();
// What this tab last asked to track. Re-applied on reconnect.
let mine: { channelId: string; userId: string } | null = null;

function refresh() {
  if (!channel) return;
  const state = channel.presenceState() as Record<string, RosterEntry[]>;
  const next = new Map<string, RosterEntry[]>();
  for (const [sessionId, metas] of Object.entries(state)) {
    for (const m of metas) {
      if (!m?.channelId || !m?.userId) continue;
      const arr = next.get(m.channelId) ?? [];
      arr.push({ channelId: m.channelId, userId: m.userId, sessionId });
      next.set(m.channelId, arr);
    }
  }
  snapshot = next;
  for (const fn of listeners) fn();
}

function ensureSubscribed(): Promise<RealtimeChannel> {
  if (subscribePromise) return subscribePromise;
  const supabase = getSupabase();
  channel = supabase.channel(TOPIC, {
    config: { presence: { key: tabSessionId } },
  });
  channel
    .on("presence", { event: "sync" }, refresh)
    .on("presence", { event: "join" }, refresh)
    .on("presence", { event: "leave" }, refresh);

  subscribePromise = new Promise((resolve) => {
    channel!.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        // Re-apply any tracking the tab already asked for (e.g., we joined
        // voice before the channel finished subscribing).
        if (mine) {
          try {
            await channel!.track(mine);
          } catch {}
        }
        refresh();
        resolve(channel!);
      }
    });
  });
  return subscribePromise;
}

export async function trackVoiceJoin(channelId: string, userId: string) {
  mine = { channelId, userId };
  const ch = await ensureSubscribed();
  try {
    await ch.track({ channelId, userId });
  } catch {}
}

export async function untrackVoiceLeave() {
  mine = null;
  if (!channel) return;
  try {
    await channel.untrack();
  } catch {}
}

export function subscribeRoster(fn: () => void): () => void {
  listeners.add(fn);
  // Lazy: kick off subscription on first listener so observer-only tabs
  // (sidebar without anyone in voice) still see other users.
  void ensureSubscribed();
  return () => {
    listeners.delete(fn);
  };
}

export function getRosterSnapshot(): Map<string, RosterEntry[]> {
  return snapshot;
}

export function getTabSessionId(): string {
  return tabSessionId;
}
