"use client";

/**
 * GroupDmChannelArea — chat view for a group DM (3+ participants).
 *
 * SECURITY NOTE: messages here are encrypted with a channelId-derived AES key
 * (see `deriveGroupDmKey`). This is a *transport* cipher, not real E2EE —
 * the server can derive the same key from the channel id. We surface the
 * caveat in the header so users aren't misled about the privacy guarantee.
 * Per-member-wrapped epoch keys for group DMs are tracked as future work.
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Users } from "lucide-react";
import { useTideCloak } from "@tidecloak/nextjs";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { TypingIndicator } from "./TypingIndicator";
import { useMessages } from "@/hooks/useMessages";
import { useTyping } from "@/hooks/useTyping";
import { useGroupDmKey } from "@/hooks/useGroupDmKey";
import { useRealtimeChannel } from "@/components/providers/RealtimeProvider";
import { encryptMessage } from "@/lib/crypto";
import type { SerializedMessage } from "@/types";

interface GroupDmChannelAreaProps {
  channelId: string;
  groupName: string;
  participantCount: number;
}

export function GroupDmChannelArea({
  channelId,
  groupName,
  participantCount,
}: GroupDmChannelAreaProps) {
  const { token, getValueFromToken } = useTideCloak();
  const myUserId = (getValueFromToken("sub") as string) ?? null;
  const groupKey = useGroupDmKey(channelId);
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
  } = useMessages(channelId, groupKey.getKey);

  const { typingUsernames, notifyTyping, stopTyping } = useTyping(channelId);

  const [replyTarget, setReplyTarget] = useState<{
    msg: SerializedMessage;
    plaintext: string;
  } | null>(null);

  const initialLoad = useRef(false);
  useEffect(() => {
    if (initialLoad.current) return;
    if (!groupKey.loading && groupKey.epochKey) {
      initialLoad.current = true;
      fetchMessages();
    }
  }, [groupKey.loading, groupKey.epochKey, fetchMessages]);
  useEffect(() => {
    initialLoad.current = false;
  }, [channelId]);

  const handleEdit = async (
    msg: SerializedMessage,
    newPlaintext: string,
  ) => {
    if (!token || !groupKey.epochKey) return;
    const ciphertext = await encryptMessage(groupKey.epochKey, newPlaintext);
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

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-surface-100/20 px-4 shadow-sm">
        <Users className="h-5 w-5 text-muted" />
        <span className="font-semibold text-white">{groupName}</span>
        <span className="ml-2 rounded bg-surface-100/40 px-1.5 py-0.5 text-xs text-muted">
          {participantCount} people
        </span>
        <span
          className="ml-auto flex items-center gap-1 rounded-full bg-yellow-500/10 px-2 py-0.5 text-xs text-yellow-300"
          title="Group DM uses a channel-id-derived key (transport encryption only)"
        >
          <AlertTriangle className="h-3 w-3" />
          Transport-only
        </span>
      </header>

      <div className="relative flex flex-1 flex-col overflow-hidden">
        <MessageList
          messages={messages}
          decryptedContent={decryptedContent}
          loading={loading}
          hasMore={hasMore}
          onLoadMore={loadMore}
          channelId={channelId}
          channelName={groupName}
          onReply={(msg, plaintext) => setReplyTarget({ msg, plaintext })}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onReact={handleReact}
        />
      </div>

      <TypingIndicator usernames={typingUsernames} />

      <MessageInput
        channelId={channelId}
        channelName={groupName}
        epochKey={groupKey.epochKey}
        keyVersion={groupKey.keyVersion}
        keyLoading={groupKey.loading}
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
