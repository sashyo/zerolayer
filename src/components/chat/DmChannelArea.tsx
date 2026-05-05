"use client";

/**
 * DmChannelArea — channel view for 1:1 DMs.
 *
 * Reuses MessageList / MessageInput / useMessages / useTyping from the
 * server-channel path; only difference is where the AES key comes from. For
 * DMs we derive ECDH(myPriv, theirPub) once (cached) and use it for every
 * message — no server epoch, no rotation.
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Lock } from "lucide-react";
import { useTideCloak } from "@tidecloak/nextjs";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { TypingIndicator } from "./TypingIndicator";
import { useMessages } from "@/hooks/useMessages";
import { useTyping } from "@/hooks/useTyping";
import { useDmKey } from "@/hooks/useDmKey";
import { useRealtimeChannel } from "@/components/providers/RealtimeProvider";
import { encryptMessage } from "@/lib/crypto";
import type { SerializedMessage } from "@/types";

interface DmChannelAreaProps {
  channelId: string;
  otherUserId: string;
  otherDisplayName: string;
}

export function DmChannelArea({
  channelId,
  otherUserId,
  otherDisplayName,
}: DmChannelAreaProps) {
  const { token, getValueFromToken } = useTideCloak();
  const myUserId = (getValueFromToken("sub") as string) ?? null;
  const dmKey = useDmKey(otherUserId);
  const realtime = useRealtimeChannel(channelId ? `messages:${channelId}` : null);

  const {
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
  } = useMessages(channelId, dmKey.getKey);

  const { typingUsernames, notifyTyping, stopTyping } = useTyping(channelId);

  const [replyTarget, setReplyTarget] = useState<{
    msg: SerializedMessage;
    plaintext: string;
  } | null>(null);

  const initialLoad = useRef(false);

  useEffect(() => {
    if (initialLoad.current) return;
    if (!dmKey.loading && dmKey.epochKey) {
      initialLoad.current = true;
      fetchMessages();
    }
  }, [dmKey.loading, dmKey.epochKey, fetchMessages]);

  useEffect(() => {
    initialLoad.current = false;
  }, [channelId]);

  // ── Edit / delete / react — same shape as ChatArea ────────────────────────
  const handleEdit = async (
    msg: SerializedMessage,
    newPlaintext: string,
  ) => {
    if (!token || !dmKey.epochKey) return;
    const ciphertext = await encryptMessage(dmKey.epochKey, newPlaintext);
    const res = await fetch(`/api/channels/${channelId}/messages/${msg.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ content: ciphertext, keyVersion: 1 }),
    });
    if (!res.ok) return;
    const { message } = await res.json();
    updateLocal(message, newPlaintext);
    realtime?.send({ type: "broadcast", event: "message:edit", payload: message });
  };

  const handleDelete = async (msg: SerializedMessage) => {
    if (!token) return;
    if (!confirm("Delete this message?")) return;
    removeLocal(msg.id);
    realtime?.send({
      type: "broadcast",
      event: "message:delete",
      payload: { messageId: msg.id },
    });
    await fetch(`/api/channels/${channelId}/messages/${msg.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  };

  const handleReact = async (
    msg: SerializedMessage,
    emoji: string,
    currentlyMine: boolean,
  ) => {
    if (!token) return;
    const adding = !currentlyMine;
    applyReactionLocal(msg.id, emoji, adding, true);
    realtime?.send({
      type: "broadcast",
      event: "reaction:toggle",
      payload: { messageId: msg.id, emoji, added: adding },
    });
    await fetch(
      `/api/channels/${channelId}/messages/${msg.id}/reactions/${encodeURIComponent(emoji)}`,
      {
        method: adding ? "POST" : "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      },
    ).catch(() => {});
  };

  const ready = !!dmKey.epochKey;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-surface-100/20 px-4 shadow-sm">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">
          {otherDisplayName.slice(0, 2).toUpperCase()}
        </div>
        <span className="font-semibold text-white">{otherDisplayName}</span>
        {ready ? (
          <span className="ml-auto flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs text-green-400">
            <Lock className="h-3 w-3" />
            E2EE
          </span>
        ) : dmKey.error ? (
          <span className="ml-auto flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-400">
            <AlertTriangle className="h-3 w-3" />
            Key error
          </span>
        ) : (
          <span className="ml-auto rounded-full bg-surface-100/40 px-2 py-0.5 text-xs text-muted">
            deriving key…
          </span>
        )}
      </header>

      {dmKey.error && (
        <div className="border-b border-red-500/20 bg-red-500/10 px-4 py-1.5 text-xs text-red-400">
          {dmKey.error}
        </div>
      )}

      <div className="relative flex flex-1 flex-col overflow-hidden">
        <MessageList
          messages={messages}
          decryptedContent={decryptedContent}
          loading={loading}
          hasMore={hasMore}
          onLoadMore={loadMore}
          channelId={channelId}
          channelName={otherDisplayName}
          onReply={(msg, plaintext) => setReplyTarget({ msg, plaintext })}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onReact={handleReact}
        />
      </div>

      <TypingIndicator usernames={typingUsernames} />

      <MessageInput
        channelId={channelId}
        channelName={otherDisplayName}
        epochKey={dmKey.epochKey}
        keyVersion={dmKey.keyVersion}
        keyLoading={dmKey.loading}
        onTyping={notifyTyping}
        onStopTyping={stopTyping}
        onSentLocal={appendLocal}
        replyTarget={replyTarget}
        onClearReply={() => setReplyTarget(null)}
        onEditLast={() => {
          if (!myUserId) return;
          for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i];
            if (
              m.authorId === myUserId &&
              m.type === "TEXT" &&
              decryptedContent.has(m.id)
            ) {
              window.dispatchEvent(
                new CustomEvent("zl:edit-message", {
                  detail: { messageId: m.id },
                }),
              );
              const el = document.getElementById(`msg-${m.id}`);
              el?.scrollIntoView({ behavior: "smooth", block: "center" });
              break;
            }
          }
        }}
      />
    </div>
  );
}
