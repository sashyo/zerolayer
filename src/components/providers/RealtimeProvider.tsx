"use client";

/**
 * RealtimeProvider — Supabase Realtime context. Replaces SocketProvider.
 *
 * The provider itself is intentionally thin: it just confirms that the
 * Supabase client is configured and exposes a `useRealtimeChannel(name)` hook.
 *
 * We deliberately do NOT share channel instances across consumers. Supabase's
 * `channel.on(...)` doesn't return a per-handler remover — only `unsubscribe`
 * works — so sharing a channel across components leaks handlers. Each call
 * to `useRealtimeChannel(name)` creates its own channel. Two hooks that need
 * the same logical room use different name suffixes (`messages:<id>`,
 * `typing:<id>`, `voice:<id>`).
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";

const Ctx = createContext<true | null>(null);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  // Touch the singleton during mount to surface misconfig early.
  useEffect(() => {
    try {
      getSupabase();
    } catch (e) {
      console.warn("[Realtime] Supabase client not configured:", e);
    }
  }, []);
  return <Ctx.Provider value={true}>{children}</Ctx.Provider>;
}

/** Subscribe to a uniquely-named Realtime channel for the lifetime of the
 *  caller. The channel is `subscribe()`d once on mount and removed on
 *  unmount. Returns null until the subscription is established so consumers
 *  can gate their `.on()` registrations on a stable channel reference. */
export function useRealtimeChannel(name: string | null): RealtimeChannel | null {
  const ctx = useContext(Ctx);
  if (ctx === null) {
    throw new Error("useRealtimeChannel must be used inside <RealtimeProvider>");
  }
  const [channel, setChannel] = useState<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!name) {
      setChannel(null);
      return;
    }
    const supabase = getSupabase();
    const ch = supabase.channel(name, {
      // self:false → the sender doesn't receive their own broadcast (we apply
      // the local update optimistically and skip the echo).
      // ack:true   → broadcast.send() resolves only after server ack.
      config: { broadcast: { self: false, ack: true } },
    });
    ch.subscribe((status) => {
      // Only expose the channel once it's actually joined; otherwise consumers
      // might attempt to send before the room exists and lose events.
      if (status === "SUBSCRIBED") setChannel(ch);
    });
    return () => {
      try {
        supabase.removeChannel(ch);
      } catch {}
      setChannel(null);
    };
  }, [name]);

  return channel;
}
