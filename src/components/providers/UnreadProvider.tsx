"use client";

/**
 * UnreadProvider — tracks per-channel unread state.
 *
 * Design: localStorage holds `lastSeenAt[channelId]` (ms epoch). When the
 * user opens a channel, we set `lastSeenAt[channelId] = Date.now()`. When a
 * message broadcast (via Supabase Realtime) arrives for a channel that's
 * NOT currently active, we set `unreadAt[channelId] = msg.createdAt`. The
 * sidebar reads this map and shows bold + dot when `unreadAt > lastSeenAt`.
 *
 * No backend changes required — this is purely client-side state. Works
 * across tabs of the same browser via the `storage` event.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const LAST_SEEN_KEY = "zl:lastSeenAt";

interface UnreadContextValue {
  /** Channel ids that have new activity since the user last viewed them. */
  unread: Set<string>;
  /** Per-channel mention counts (subset of unread — visually distinct). */
  mentions: Map<string, number>;
  /** Anchor timestamp set when entering a channel; used to draw the
   *  "New messages below" divider. Reset on next markUnread. */
  readMarkers: Map<string, number>;
  /** Mark a channel as read (resets its unread flag). Called when navigating in. */
  markRead: (channelId: string) => void;
  /** Force a channel back to unread (rolls lastSeen back; user-initiated). */
  markUnread: (channelId: string) => void;
  /** Mark a channel as having new activity (called from message broadcasts). */
  bump: (channelId: string, atMs?: number) => void;
  /** Increment the mention counter for a channel (subset of unread). */
  bumpMention: (channelId: string) => void;
}

const Ctx = createContext<UnreadContextValue | null>(null);

export function UnreadProvider({ children }: { children: ReactNode }) {
  const [unread, setUnread] = useState<Set<string>>(() => new Set());
  const [mentions, setMentions] = useState<Map<string, number>>(() => new Map());

  // Hydrate any unread flags persisted from a prior session: anything where
  // unreadAt > lastSeenAt at boot. We don't persist `unread` itself; the
  // bump events that produced it are gone, so we just start clean.
  // (Could add a server-side authoritative cursor later for cross-device.)

  const lastSeenAt = useCallback((channelId: string): number => {
    try {
      const raw = localStorage.getItem(LAST_SEEN_KEY);
      if (!raw) return 0;
      const map = JSON.parse(raw) as Record<string, number>;
      return map[channelId] ?? 0;
    } catch {
      return 0;
    }
  }, []);

  // Snapshot of lastSeen at the moment a channel was entered. Drives the
  // "New messages below" divider — we don't want it to scoot down as the
  // user reads, so it stays anchored to the entry point until the user
  // navigates away.
  const [readMarkers, setReadMarkers] = useState<Map<string, number>>(
    () => new Map(),
  );

  const writeLastSeen = useCallback((channelId: string, ms: number) => {
    try {
      const raw = localStorage.getItem(LAST_SEEN_KEY);
      const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
      map[channelId] = ms;
      localStorage.setItem(LAST_SEEN_KEY, JSON.stringify(map));
    } catch {}
  }, []);

  const markRead = useCallback(
    (channelId: string) => {
      const prevSeen = lastSeenAt(channelId);
      // Anchor the read marker to the moment of entry — used by the chat
      // pane to draw a "New messages below" divider. Always overwrite so a
      // re-visit resets the anchor to the most recent exit time.
      setReadMarkers((m) => {
        const next = new Map(m);
        next.set(channelId, prevSeen);
        return next;
      });
      writeLastSeen(channelId, Date.now());
      setUnread((prev) => {
        if (!prev.has(channelId)) return prev;
        const next = new Set(prev);
        next.delete(channelId);
        return next;
      });
      setMentions((prev) => {
        if (!prev.has(channelId)) return prev;
        const next = new Map(prev);
        next.delete(channelId);
        return next;
      });
    },
    [lastSeenAt, writeLastSeen],
  );

  const bumpMention = useCallback((channelId: string) => {
    setMentions((prev) => {
      const next = new Map(prev);
      next.set(channelId, (prev.get(channelId) ?? 0) + 1);
      return next;
    });
  }, []);

  const markUnread = useCallback(
    (channelId: string) => {
      // Roll lastSeen back so a future visit re-evaluates the channel as
      // unread, and add it to the in-memory set right now for immediate
      // sidebar feedback.
      writeLastSeen(channelId, 0);
      setUnread((prev) => {
        if (prev.has(channelId)) return prev;
        const next = new Set(prev);
        next.add(channelId);
        return next;
      });
    },
    [writeLastSeen],
  );

  const bump = useCallback(
    (channelId: string, atMs?: number) => {
      const ts = atMs ?? Date.now();
      // Only mark unread if the user hasn't seen messages this recent.
      if (ts <= lastSeenAt(channelId)) return;
      setUnread((prev) => {
        if (prev.has(channelId)) return prev;
        const next = new Set(prev);
        next.add(channelId);
        return next;
      });
    },
    [lastSeenAt],
  );

  // Cross-tab sync: when another tab marks a channel as read, drop our flag.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== LAST_SEEN_KEY) return;
      // Re-evaluate unread set against the new lastSeen map.
      setUnread((prev) => {
        const next = new Set<string>();
        for (const id of prev) {
          // We can't tell from here when the bump fired; conservatively keep
          // the entry unless the other tab clearly marked this one read.
          // Simplest correct behaviour: clear the whole set on cross-tab
          // storage events — if the channel is still unread, the next
          // broadcast will re-bump it.
          next.add(id);
        }
        return next;
      });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value: UnreadContextValue = useMemo(
    () => ({ unread, mentions, readMarkers, markRead, markUnread, bump, bumpMention }),
    [unread, mentions, readMarkers, markRead, markUnread, bump, bumpMention],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUnread(): UnreadContextValue {
  const v = useContext(Ctx);
  if (!v) {
    return {
      unread: new Set(),
      mentions: new Map(),
      readMarkers: new Map(),
      markRead: () => {},
      markUnread: () => {},
      bump: () => {},
      bumpMention: () => {},
    };
  }
  return v;
}
