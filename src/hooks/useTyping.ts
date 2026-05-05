"use client";

/**
 * useTyping — local typing indicator broadcast over Supabase Realtime.
 *
 * Each user emits `typing:start` when they begin typing and `typing:stop`
 * when they stop or after 3s of inactivity. Receivers maintain a per-user
 * timer that auto-clears the indicator if the stop event is dropped.
 *
 * The username is read from the TideCloak token rather than echoed by
 * server logic — so the broadcast payload never relies on server state.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTideCloak } from "@tidecloak/nextjs";
import { useRealtimeChannel } from "@/components/providers/RealtimeProvider";

const TYPING_TIMEOUT_MS = 3_000;

export function useTyping(channelId: string | null) {
  const { getValueFromToken } = useTideCloak();
  const channel = useRealtimeChannel(channelId ? `typing:${channelId}` : null);
  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map());
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const isTypingRef = useRef(false);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Listen for remote typing events.
  useEffect(() => {
    if (!channel) return;
    channel
      .on("broadcast", { event: "typing:start" }, ({ payload }) => {
        const { userId, username } = payload as { userId: string; username: string };
        setTypingUsers((prev) => {
          const next = new Map(prev);
          next.set(userId, username);
          return next;
        });
        const existing = typingTimers.current.get(userId);
        if (existing) clearTimeout(existing);
        typingTimers.current.set(
          userId,
          setTimeout(() => {
            setTypingUsers((prev) => {
              const next = new Map(prev);
              next.delete(userId);
              return next;
            });
            typingTimers.current.delete(userId);
          }, TYPING_TIMEOUT_MS),
        );
      })
      .on("broadcast", { event: "typing:stop" }, ({ payload }) => {
        const { userId } = payload as { userId: string };
        clearTimeout(typingTimers.current.get(userId));
        typingTimers.current.delete(userId);
        setTypingUsers((prev) => {
          const next = new Map(prev);
          next.delete(userId);
          return next;
        });
      });
  }, [channel]);

  const userId = (getValueFromToken("sub") as string) || "";
  const username =
    (getValueFromToken("preferred_username") as string) ||
    (getValueFromToken("name") as string) ||
    "Someone";

  const notifyTyping = useCallback(() => {
    if (!channel) return;
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      channel.send({
        type: "broadcast",
        event: "typing:start",
        payload: { userId, username },
      });
    }
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = setTimeout(() => {
      isTypingRef.current = false;
      channel.send({
        type: "broadcast",
        event: "typing:stop",
        payload: { userId },
      });
    }, TYPING_TIMEOUT_MS);
  }, [channel, userId, username]);

  const stopTyping = useCallback(() => {
    if (!channel || !isTypingRef.current) return;
    if (stopTimer.current) clearTimeout(stopTimer.current);
    isTypingRef.current = false;
    channel.send({
      type: "broadcast",
      event: "typing:stop",
      payload: { userId },
    });
  }, [channel, userId]);

  return {
    typingUsers,
    typingUsernames: Array.from(typingUsers.values()),
    notifyTyping,
    stopTyping,
  };
}
