"use client";

/**
 * useUnreadListener — subscribes to a Supabase Realtime broadcast channel for
 * every channel id the user is a member of, and bumps the unread flag in
 * UnreadProvider when a `message:new` broadcast arrives for a channel that
 * isn't currently active.
 *
 * Mounted once at app-shell level. Channel ids come from the AppShell's
 * `servers` list (text channels) plus the DM list. We open one Supabase
 * Realtime channel per id — Supabase recommends a few hundred concurrent
 * subscriptions per project as fine, and a typical user has tens of channels
 * at most.
 *
 * Why not Postgres Realtime instead: the message rows are inserted by the
 * sender's REST POST, but the broadcast is what every other client already
 * subscribes to in `useMessages`. Reusing it keeps the wire-format aligned
 * and avoids needing replication permissions on the messages table.
 */
import { useEffect, useMemo } from "react";
import { usePathname } from "next/navigation";
import { useTideCloak } from "@tidecloak/nextjs";
import { useUnread } from "@/components/providers/UnreadProvider";
import { getSupabase } from "@/lib/supabase";
import { playMentionPing } from "@/lib/notify-sound";
import { isChannelMuted } from "@/lib/channelMutes";

export function useUnreadListener(
  channelIds: string[],
  dmChannelIds: string[] = [],
) {
  const { authenticated, getValueFromToken } = useTideCloak();
  const { bump, bumpMention } = useUnread();
  const pathname = usePathname();
  const myUserId = (getValueFromToken("sub") as string) ?? null;

  // Stable join of ids so the effect dep array doesn't churn on every render.
  const idsKey = useMemo(() => [...channelIds].sort().join(","), [channelIds]);
  const dmKey = useMemo(
    () => [...dmChannelIds].sort().join(","),
    [dmChannelIds],
  );

  useEffect(() => {
    if (!authenticated || channelIds.length === 0) return;
    const supabase = getSupabase();
    const dmSet = new Set(dmChannelIds);

    // Subscribe one channel per id. We don't try to share with `useMessages`
    // because Supabase doesn't expose a per-handler removal — having two
    // subscribers means each gets its own channel instance, which is fine.
    const channels = channelIds.map((id) => {
      const ch = supabase.channel(`messages:${id}`, {
        config: { broadcast: { self: false } },
      });
      ch.on("broadcast", { event: "message:new" }, ({ payload }) => {
        const msg = payload as {
          channelId?: string;
          createdAt?: string;
          mentions?: string[];
          author?: { displayName?: string; username?: string };
        };
        const active = pathname?.includes(`/${id}`);
        const mentionsMe =
          !!myUserId && Array.isArray(msg.mentions) && msg.mentions.includes(myUserId);
        const isDm = dmSet.has(id);
        if (active) return;
        const ts = msg.createdAt ? new Date(msg.createdAt).getTime() : Date.now();
        bump(id, ts);
        // Muted channels keep the unread dot but skip pings, badges, and
        // browser notifications.
        if (isChannelMuted(id)) return;
        // Mention badge fires for explicit @mentions OR for any DM message,
        // since DMs are inherently directed at the recipient (Discord parity).
        if (mentionsMe || isDm) {
          bumpMention(id);
          // Play a short ping; harmless if autoplay is blocked.
          playMentionPing();
          if (
            typeof window !== "undefined" &&
            "Notification" in window &&
            Notification.permission === "granted" &&
            document.visibilityState !== "visible"
          ) {
            const who =
              msg.author?.displayName || msg.author?.username || "Someone";
            const title = isDm
              ? `${who} sent you a message`
              : `${who} mentioned you`;
            try {
              new Notification(title, {
                body: "Click to open the conversation.",
                tag: `notify:${id}`,
              });
            } catch {}
          }
        }
      }).subscribe();
      return ch;
    });

    return () => {
      for (const ch of channels) {
        try {
          supabase.removeChannel(ch);
        } catch {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, dmKey, authenticated, pathname, myUserId]);
}
