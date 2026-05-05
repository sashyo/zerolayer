"use client";

/**
 * ChatArea — channel view in keypair-mode.
 *
 *   server epoch wraps  ─►  unwrap on demand  ─►  AES-GCM en/decrypt messages
 *
 *  Per-server epoch key (cached in useServerKey for the session) gates both
 *  encrypt and decrypt. No per-channel policy material exists.
 */
import { useEffect, useRef, useState } from "react";
import { Hash, Lock, AlertTriangle, KeyRound, Loader2, Pin, Search } from "lucide-react";
import { useTideCloak } from "@tidecloak/nextjs";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { TypingIndicator } from "./TypingIndicator";
import { useMessages } from "@/hooks/useMessages";
import { useTyping } from "@/hooks/useTyping";
import { useServerKey } from "@/hooks/useServerKey";
import { useKeys } from "@/components/providers/KeysProvider";
import {
  generateEpochKey,
  wrapEpochForRecipient,
  encryptMessage,
  unwrapEpochWithPrivate,
} from "@/lib/crypto";
import { useRealtimeChannel } from "@/components/providers/RealtimeProvider";
import { PinnedDrawer } from "./PinnedDrawer";
import { ChannelSearch } from "./ChannelSearch";
import type { SerializedMessage, SerializedMember } from "@/types";

interface ChatAreaProps {
  serverId: string | null; // null for DMs (DM keys are out of scope here)
  channelId: string;
  channelName: string;
  channelDescription?: string | null;
  channelType?: string;
  isPrivate?: boolean;
  members?: SerializedMember[];
}

export function ChatArea({
  serverId,
  channelId,
  channelName,
  channelDescription,
  channelType = "TEXT",
  isPrivate = false,
  members = [],
}: ChatAreaProps) {
  const { token, getValueFromToken } = useTideCloak();
  const { publicKeyB64, getPrivateKey } = useKeys();
  const serverKey = useServerKey(serverId);
  const [currentEpoch, setCurrentEpoch] = useState<CryptoKey | null>(null);
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);

  // Pending epoch-key wraps for members who joined via invite without a wrap.
  // Only the owner can grant access; non-owners ignore this state.
  const [pendingWraps, setPendingWraps] = useState<
    Array<{ userId: string; username: string; displayName: string; publicKey: string }>
  >([]);
  const [granting, setGranting] = useState(false);
  const [grantError, setGrantError] = useState<string | null>(null);

  // Owner-only recovery: if no wrap exists for me, mint a fresh epoch and
  // self-wrap. This handles pre-existing servers (created before keypair-mode)
  // and the rare race where the create-time POST never landed. New messages
  // will use the new version; old ones (if any) become undecryptable.
  const myUserId = (getValueFromToken("sub") as string) || null;
  const [serverOwnerId, setServerOwnerId] = useState<string | null>(null);

  useEffect(() => {
    if (!serverId || !token) return;
    fetch("/api/servers", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(({ servers }) => {
        const s = (servers ?? []).find((x: any) => x.id === serverId);
        setServerOwnerId(s?.ownerId ?? null);
      })
      .catch(() => {});
  }, [serverId, token]);

  const isOwner = !!myUserId && !!serverOwnerId && myUserId === serverOwnerId;

  // Owner-only: poll for members who joined via invite and don't have a wrap
  // for the current epoch. They show up here until we grant them access.
  useEffect(() => {
    if (!isOwner || !serverId || !token) return;
    let cancelled = false;
    const fetchPending = () =>
      fetch(`/api/servers/${serverId}/members/missing-wraps`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => (r.ok ? r.json() : { missing: [] }))
        .then((d) => {
          if (!cancelled) setPendingWraps(d.missing ?? []);
        })
        .catch(() => {});
    fetchPending();
    // Re-poll on a slow interval so a new joiner appears within ~15s for the
    // owner without needing a manual refresh.
    const t = window.setInterval(fetchPending, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [isOwner, serverId, token]);

  /** Wrap the current epoch for every pending member and post the wraps.
   *  Pulls the owner's own current wrap, decrypts the epoch, then for each
   *  pending member generates a fresh ephemeral keypair and wraps. */
  const handleGrantAccess = async () => {
    if (!serverId || !token || pendingWraps.length === 0) return;
    setGrantError(null);
    setGranting(true);
    try {
      // Resolve our own copy of the current epoch.
      const ver = serverKey.currentKeyVersion;
      if (ver == null) throw new Error("server has no current key version");
      let epoch = currentEpoch;
      if (!epoch) {
        epoch = await serverKey.getKey(ver);
      }
      if (!epoch) {
        // Fall back: pull our wrap from /keys and unwrap manually.
        const myWrapsRes = await fetch(`/api/servers/${serverId}/keys`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const myKeys = await myWrapsRes.json();
        const myCurrent = (myKeys.wraps ?? []).find(
          (w: any) => w.version === ver,
        );
        if (!myCurrent) throw new Error("you have no wrap for the current epoch");
        const myPriv = await getPrivateKey();
        epoch = await unwrapEpochWithPrivate(myPriv, {
          ephemeralPubB64: myCurrent.ephemeralPub,
          ivB64: myCurrent.iv,
          wrappedKeyB64: myCurrent.wrappedKey,
        });
      }

      for (const m of pendingWraps) {
        const wrap = await wrapEpochForRecipient(epoch, m.publicKey);
        const res = await fetch(`/api/servers/${serverId}/keys`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            userId: m.userId,
            version: ver,
            ephemeralPub: wrap.ephemeralPubB64,
            iv: wrap.ivB64,
            wrappedKey: wrap.wrappedKeyB64,
          }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`wrap POST for ${m.username} ${res.status}: ${body}`);
        }
      }
      // Drop them from the pending list — next poll will confirm.
      setPendingWraps([]);
    } catch (err: any) {
      console.error("[grant-access] failed", err);
      setGrantError(err.message || "Failed to grant access");
    } finally {
      setGranting(false);
    }
  };

  const handleMint = async () => {
    if (!serverId || !token || !publicKeyB64) return;
    setMintError(null);
    setMinting(true);
    try {
      const epoch = await generateEpochKey();
      const wrap = await wrapEpochForRecipient(epoch, publicKeyB64);
      const nextVersion = (serverKey.currentKeyVersion ?? 0) + 1;
      const res = await fetch(`/api/servers/${serverId}/keys`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          userId: myUserId,
          version: nextVersion,
          ephemeralPub: wrap.ephemeralPubB64,
          iv: wrap.ivB64,
          wrappedKey: wrap.wrappedKeyB64,
          bumpToCurrent: true,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`mint POST ${res.status}: ${body}`);
      }
      window.location.reload();
    } catch (err: any) {
      setMintError(err.message || "Failed to mint key");
    } finally {
      setMinting(false);
    }
  };

  // Resolve the current epoch CryptoKey for the sender path. Decrypt-side
  // (per-message versions) goes through `serverKey.getKey` directly.
  const [unwrapError, setUnwrapError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setUnwrapError(null);
    if (serverKey.currentKeyVersion == null || !serverKey.hasMyWrap) {
      setCurrentEpoch(null);
      return;
    }
    serverKey
      .getKey(serverKey.currentKeyVersion)
      .then((k) => {
        if (!cancelled) setCurrentEpoch(k);
      })
      .catch((err: any) => {
        console.error("[ChatArea] unwrap failed", err);
        if (!cancelled)
          setUnwrapError(err?.message || "Failed to unlock server key");
      });
    return () => {
      cancelled = true;
    };
  }, [serverKey.currentKeyVersion, serverKey.hasMyWrap, serverKey.getKey]);

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
  } = useMessages(channelId, serverKey.getKey);
  const { typingUsernames, notifyTyping, stopTyping } = useTyping(channelId);

  // ── Reply state (passed down to MessageInput as the active draft target) ──
  const [replyTarget, setReplyTarget] = useState<{
    msg: SerializedMessage;
    plaintext: string;
  } | null>(null);

  // ── Pinned drawer + search drawer ────────────────────────────────────────
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // ── Channel topic (description) ───────────────────────────────────────────
  const [topic, setTopic] = useState<string>(channelDescription ?? "");
  const [editingTopic, setEditingTopic] = useState(false);
  const [topicDraft, setTopicDraft] = useState("");
  useEffect(() => {
    setTopic(channelDescription ?? "");
  }, [channelDescription]);

  const saveTopic = async () => {
    if (!token) return;
    const next = topicDraft.trim();
    setTopic(next);
    setEditingTopic(false);
    await fetch(`/api/channels/${channelId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ description: next || null }),
    }).catch(() => {});
  };

  const handleTogglePin = async (msg: SerializedMessage) => {
    if (!token) return;
    const method = msg.isPinned ? "DELETE" : "POST";
    const res = await fetch(
      `/api/channels/${channelId}/messages/${msg.id}/pin`,
      { method, headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      console.warn("[ChatArea] pin failed", await res.text().catch(() => ""));
      return;
    }
    const { message } = await res.json();
    updateLocal(message, decryptedContent.get(msg.id));
  };

  const handleReply = (msg: SerializedMessage, plaintext: string) =>
    setReplyTarget({ msg, plaintext });

  // ── Edit (re-encrypt → PATCH → optimistic update + broadcast) ─────────────
  const handleEdit = async (
    msg: SerializedMessage,
    newPlaintext: string,
  ) => {
    if (!token || !currentEpoch || serverKey.currentKeyVersion == null) return;
    const ciphertext = await encryptMessage(currentEpoch, newPlaintext);
    const res = await fetch(`/api/channels/${channelId}/messages/${msg.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        content: ciphertext,
        keyVersion: serverKey.currentKeyVersion,
      }),
    });
    if (!res.ok) {
      console.warn("[ChatArea] edit failed", await res.text().catch(() => ""));
      return;
    }
    const { message } = await res.json();
    updateLocal(message, newPlaintext);
    realtime?.send({
      type: "broadcast",
      event: "message:edit",
      payload: message,
    });
  };

  // ── Delete (DELETE → optimistic remove + broadcast) ───────────────────────
  const handleDelete = async (msg: SerializedMessage) => {
    if (!token) return;
    if (!confirm("Delete this message?")) return;
    removeLocal(msg.id);
    realtime?.send({
      type: "broadcast",
      event: "message:delete",
      payload: { messageId: msg.id },
    });
    const res = await fetch(`/api/channels/${channelId}/messages/${msg.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.warn("[ChatArea] delete failed", await res.text().catch(() => ""));
    }
  };

  // ── Reactions (POST/DELETE → optimistic toggle + broadcast) ───────────────
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
      payload: {
        messageId: msg.id,
        emoji,
        added: adding,
      },
    });
    await fetch(
      `/api/channels/${channelId}/messages/${msg.id}/reactions/${encodeURIComponent(emoji)}`,
      {
        method: adding ? "POST" : "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      },
    ).catch(() => {});
  };

  const initialLoad = useRef(false);

  useEffect(() => {
    if (initialLoad.current) return;
    if (!serverKey.loading) {
      initialLoad.current = true;
      fetchMessages();
    }
  }, [serverKey.loading, fetchMessages]);

  useEffect(() => {
    initialLoad.current = false;
  }, [channelId]);

  const ready = !!currentEpoch && serverKey.hasMyWrap;
  const noWrap = !serverKey.loading && !serverKey.hasMyWrap;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-surface-100/20 px-4 shadow-sm">
        <Hash className="h-5 w-5 text-muted" />
        <span className="font-semibold text-white">{channelName}</span>
        {/* Topic — vertical divider + clickable single-line description */}
        <div className="ml-2 flex h-5 items-center gap-2">
          <div className="h-full w-px bg-surface-100/40" />
          {editingTopic ? (
            <input
              autoFocus
              value={topicDraft}
              onChange={(e) => setTopicDraft(e.target.value)}
              onBlur={saveTopic}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveTopic();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setEditingTopic(false);
                }
              }}
              maxLength={1024}
              placeholder="Set a topic"
              className="w-72 truncate bg-transparent text-sm text-white placeholder-muted/60 focus:outline-none"
            />
          ) : (
            <button
              type="button"
              disabled={!isOwner}
              onClick={() => {
                if (!isOwner) return;
                setTopicDraft(topic);
                setEditingTopic(true);
              }}
              className={
                "max-w-md truncate text-left text-sm text-muted " +
                (isOwner ? "hover:text-white" : "")
              }
              title={isOwner ? "Click to edit topic" : topic || ""}
            >
              {topic || (isOwner ? "Set a topic" : "")}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setPinnedOpen((v) => !v)}
          className={
            "ml-2 rounded p-1 text-muted hover:bg-surface-100/40 hover:text-white" +
            (pinnedOpen ? " bg-surface-100/40 text-white" : "")
          }
          title="Pinned messages"
        >
          <Pin className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setSearchOpen((v) => !v)}
          className={
            "rounded p-1 text-muted hover:bg-surface-100/40 hover:text-white" +
            (searchOpen ? " bg-surface-100/40 text-white" : "")
          }
          title="Search this channel"
        >
          <Search className="h-4 w-4" />
        </button>
        {ready && (
          <span className="ml-auto flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs text-green-400">
            <Lock className="h-3 w-3" />
            E2EE
          </span>
        )}
        {noWrap && (
          <span
            className="ml-auto flex items-center gap-1 rounded-full bg-yellow-500/10 px-2 py-0.5 text-xs text-yellow-400"
            title="No epoch wrap for your account on this server"
          >
            <AlertTriangle className="h-3 w-3" />
            Awaiting key
          </span>
        )}
        {noWrap && isOwner && (
          <button
            onClick={handleMint}
            disabled={minting || !publicKeyB64}
            className="ml-2 flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand hover:bg-brand/20 disabled:opacity-50"
            title="Generate a fresh server key for this account"
          >
            {minting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <KeyRound className="h-3 w-3" />
            )}
            Mint key
          </button>
        )}
        {isOwner && pendingWraps.length > 0 && (
          <button
            onClick={handleGrantAccess}
            disabled={granting}
            className="ml-2 flex items-center gap-1 rounded-full bg-yellow-500/10 px-2 py-0.5 text-xs text-yellow-300 hover:bg-yellow-500/20 disabled:opacity-50"
            title={`Wrap server key for ${pendingWraps.length} pending member(s)`}
          >
            {granting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <KeyRound className="h-3 w-3" />
            )}
            Grant access ({pendingWraps.length})
          </button>
        )}
      </header>
      {mintError && (
        <div className="border-b border-red-500/20 bg-red-500/10 px-4 py-1.5 text-xs text-red-400">
          {mintError}
        </div>
      )}
      {grantError && (
        <div className="border-b border-red-500/20 bg-red-500/10 px-4 py-1.5 text-xs text-red-400">
          Grant access failed: {grantError}
        </div>
      )}
      {unwrapError && (
        <div className="border-b border-red-500/20 bg-red-500/10 px-4 py-1.5 text-xs text-red-400">
          Unlock failed: {unwrapError}
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
          channelName={channelName}
          isServerOwner={isOwner}
          onReply={handleReply}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onReact={handleReact}
          onTogglePin={handleTogglePin}
        />
      </div>

      <TypingIndicator usernames={typingUsernames} />

      <MessageInput
        channelId={channelId}
        channelName={channelName}
        epochKey={currentEpoch}
        keyVersion={serverKey.currentKeyVersion}
        keyLoading={serverKey.loading}
        onTyping={notifyTyping}
        onStopTyping={stopTyping}
        onSentLocal={appendLocal}
        replyTarget={replyTarget}
        onClearReply={() => setReplyTarget(null)}
        members={members}
        onEditLast={() => {
          if (!myUserId) return;
          // Walk newest-to-oldest so the most recent eligible message wins.
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

      {pinnedOpen && (
        <PinnedDrawer
          channelId={channelId}
          isServerOwner={isOwner}
          getKey={serverKey.getKey}
          onClose={() => setPinnedOpen(false)}
          onUnpinned={(msg) =>
            updateLocal(msg, decryptedContent.get(msg.id))
          }
        />
      )}

      {searchOpen && (
        <ChannelSearch
          messages={messages}
          decryptedContent={decryptedContent}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </div>
  );
}
