"use client";

/**
 * useMessages — fetches/streams a channel's messages and decrypts them with
 * the parent server's epoch keys.
 *
 * Each message carries its own `keyVersion`. The caller hands us a `getKey`
 * function (from useServerKey) that resolves a CryptoKey for any version we
 * still have a wrap for. Decrypting historical messages survives epoch
 * rotation as long as the user kept their wrap for that version.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTideCloak } from "@tidecloak/nextjs";
import { useRealtimeChannel } from "@/components/providers/RealtimeProvider";
import { decryptMessage } from "@/lib/crypto";
import type { SerializedMessage } from "@/types";

type GetKey = (version: number) => Promise<CryptoKey | null>;

export function useMessages(channelId: string | null, getKey: GetKey | null) {
  const { token } = useTideCloak();
  const channel = useRealtimeChannel(channelId ? `messages:${channelId}` : null);

  const [messages, setMessages] = useState<SerializedMessage[]>([]);
  const [decryptedContent, setDecryptedContent] = useState<Map<string, string>>(
    new Map(),
  );
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);

  const getKeyRef = useRef<GetKey | null>(null);
  useEffect(() => {
    getKeyRef.current = getKey;
  }, [getKey]);

  // Group by keyVersion → resolve each version's CryptoKey once (cached after
  // first call) → fan out the AES-GCM decryptions in parallel. WebCrypto runs
  // these off the JS thread so Promise.all gives a real wall-clock win on
  // initial fetch.
  const decryptBatch = useCallback(async (msgs: SerializedMessage[]) => {
    if (!msgs.length) return;
    const fn = getKeyRef.current;
    if (!fn) return;

    const text = msgs.filter((m) => m.type === "TEXT");
    if (text.length === 0) return;

    // Group BOTH the messages AND their replyTo previews by keyVersion so we
    // can decrypt the surfaced reply snippet alongside the message itself.
    const byVersion = new Map<number, Array<{ id: string; content: string }>>();
    const push = (v: number, id: string, content: string) => {
      const arr = byVersion.get(v);
      if (arr) arr.push({ id, content });
      else byVersion.set(v, [{ id, content }]);
    };
    for (const m of text) {
      push(m.keyVersion ?? 1, m.id, m.content);
      if (m.replyTo) push(m.replyTo.keyVersion ?? 1, m.replyTo.id, m.replyTo.content);
    }

    const out = new Map<string, string>();

    await Promise.all(
      Array.from(byVersion.entries()).map(async ([version, group]) => {
        let key: CryptoKey | null = null;
        try {
          key = await fn(version);
        } catch (err) {
          console.warn(
            "[useMessages] failed to resolve key version",
            version,
            err,
          );
          return;
        }
        if (!key) return;

        await Promise.all(
          group.map(async ({ id, content }) => {
            if (out.has(id)) return; // dedup (same msg referenced as reply too)
            try {
              const plain = await decryptMessage(key!, content);
              out.set(id, plain);
            } catch (err) {
              console.warn("[useMessages] decrypt failed for", id, err);
            }
          }),
        );
      }),
    );

    if (out.size === 0) return;
    setDecryptedContent((prev) => {
      const next = new Map(prev);
      for (const [k, v] of out) next.set(k, v);
      return next;
    });
  }, []);

  const fetchMessages = useCallback(
    async (before?: string) => {
      if (!channelId || !token) return;
      setLoading(true);
      try {
        const url = `/api/channels/${channelId}/messages?limit=50${before ? `&before=${before}` : ""}`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json();
        const fetched: SerializedMessage[] = body.messages ?? [];
        const more: boolean = body.hasMore ?? false;
        const nextCursor: string | null = body.cursor ?? null;

        setMessages((prev) => (before ? [...fetched, ...prev] : fetched));
        setHasMore(more);
        setCursor(nextCursor);

        await decryptBatch(fetched);
      } finally {
        setLoading(false);
      }
    },
    [channelId, token, decryptBatch],
  );

  useEffect(() => {
    setMessages([]);
    setDecryptedContent(new Map());
    setCursor(null);
    setHasMore(false);
  }, [channelId]);

  // Real-time subscription for message lifecycle events. Each broadcast event
  // payload mirrors the previous Socket.IO contract; the channel itself is
  // configured with `self: false` so the sender doesn't receive an echo of
  // their own broadcast (we apply the local update optimistically).
  useEffect(() => {
    if (!channel) return;

    channel
      .on("broadcast", { event: "message:new" }, ({ payload }) => {
        const msg = payload as SerializedMessage;
        setMessages((prev) =>
          prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
        );
        decryptBatch([msg]);
      })
      .on("broadcast", { event: "message:edit" }, ({ payload }) => {
        const msg = payload as SerializedMessage;
        setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)));
        decryptBatch([msg]);
      })
      .on("broadcast", { event: "message:delete" }, ({ payload }) => {
        const { messageId } = payload as { messageId: string };
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
        setDecryptedContent((prev) => {
          const next = new Map(prev);
          next.delete(messageId);
          return next;
        });
      })
      .on("broadcast", { event: "reaction:toggle" }, ({ payload }) => {
        const { messageId, emoji, added } = payload as {
          messageId: string;
          emoji: string;
          added: boolean;
        };
        // Other users' reactions: `mine` is always false here (broadcast
        // self:false means we never receive our own echo).
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== messageId) return m;
            const idx = m.reactions.findIndex((r) => r.emoji === emoji);
            const next = [...m.reactions];
            if (added) {
              if (idx >= 0) {
                next[idx] = { ...next[idx], count: next[idx].count + 1 };
              } else {
                next.push({ emoji, count: 1, me: false });
              }
            } else if (idx >= 0) {
              const newCount = next[idx].count - 1;
              if (newCount <= 0) next.splice(idx, 1);
              else next[idx] = { ...next[idx], count: newCount };
            }
            return { ...m, reactions: next };
          }),
        );
      });
    // No per-handler removal needed: the channel itself is torn down by
    // RealtimeProvider when this hook unmounts.
  }, [channel, decryptBatch]);

  const loadMore = useCallback(
    () => fetchMessages(cursor ?? undefined),
    [fetchMessages, cursor],
  );

  // Optimistic local insert + decrypt. Sender uses this immediately after the
  // POST returns so the message appears even if the socket round-trip drops.
  const appendLocal = useCallback(
    (msg: SerializedMessage, plaintext?: string) => {
      setMessages((prev) =>
        prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
      );
      if (plaintext) {
        setDecryptedContent((prev) => {
          if (prev.has(msg.id)) return prev;
          const next = new Map(prev);
          next.set(msg.id, plaintext);
          return next;
        });
      } else {
        decryptBatch([msg]);
      }
    },
    [decryptBatch],
  );

  /** Replace an existing message in-place (used after edit). */
  const updateLocal = useCallback(
    (msg: SerializedMessage, plaintext?: string) => {
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)));
      if (plaintext !== undefined) {
        setDecryptedContent((prev) => {
          const next = new Map(prev);
          next.set(msg.id, plaintext);
          return next;
        });
      } else {
        decryptBatch([msg]);
      }
    },
    [decryptBatch],
  );

  /** Remove a message locally (used after delete). */
  const removeLocal = useCallback((messageId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    setDecryptedContent((prev) => {
      if (!prev.has(messageId)) return prev;
      const next = new Map(prev);
      next.delete(messageId);
      return next;
    });
  }, []);

  /** Apply a reaction toggle locally without refetching. */
  const applyReactionLocal = useCallback(
    (messageId: string, emoji: string, added: boolean, mine: boolean) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          const idx = m.reactions.findIndex((r) => r.emoji === emoji);
          const next = [...m.reactions];
          if (added) {
            if (idx >= 0) {
              next[idx] = {
                ...next[idx],
                count: next[idx].count + 1,
                me: mine ? true : next[idx].me,
              };
            } else {
              next.push({ emoji, count: 1, me: mine });
            }
          } else if (idx >= 0) {
            const newCount = next[idx].count - 1;
            if (newCount <= 0) next.splice(idx, 1);
            else next[idx] = { ...next[idx], count: newCount, me: mine ? false : next[idx].me };
          }
          return { ...m, reactions: next };
        }),
      );
    },
    [],
  );

  return {
    messages,
    decryptedContent,
    loading,
    hasMore,
    fetchMessages,
    loadMore,
    appendLocal,
    updateLocal,
    removeLocal,
    applyReactionLocal,
  };
}
