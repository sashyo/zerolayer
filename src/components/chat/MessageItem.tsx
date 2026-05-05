"use client";

/**
 * MessageItem — single message row.
 *
 * Owns: hover-action bar, inline edit textarea, reply pill click target,
 *       reaction picker, markdown rendering of plaintext.
 *
 * Encryption knowledge stays in ChatArea: the actions (edit, react, delete,
 * reply) are passed in as callbacks that receive plaintext / message id and
 * the parent encrypts/PATCHes/POSTs as needed.
 */
import { useEffect, useRef, useState } from "react";
import {
  Lock,
  AlertCircle,
  Smile,
  Reply,
  Pencil,
  Trash2,
  CornerDownRight,
  Pin,
  PinOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTideCloak } from "@tidecloak/nextjs";
import { MessageContent } from "./MessageContent";
import { EmojiPicker } from "./EmojiPicker";
import { openProfile } from "./ProfilePopover";
import { Avatar } from "@/components/Avatar";
import {
  MessageContextMenu,
  MENU_ICONS,
  type MenuAction,
} from "./MessageContextMenu";
import { ForwardModal } from "./ForwardModal";
import { useUnread } from "@/components/providers/UnreadProvider";
import { showToast } from "@/components/Toast";
import {
  isMessageSaved,
  toggleSaveMessage,
} from "@/lib/savedMessages";
import type { SerializedMessage } from "@/types";

interface MessageItemProps {
  message: SerializedMessage;
  plaintext: string | undefined;
  /** plaintext of the replyTo preview, if available */
  replyPlaintext?: string;
  isFirst: boolean;
  channelId: string;
  isServerOwner?: boolean;
  onReply?: (msg: SerializedMessage, plaintext: string) => void;
  onEdit?: (msg: SerializedMessage, newPlaintext: string) => Promise<void> | void;
  onDelete?: (msg: SerializedMessage) => Promise<void> | void;
  onReact?: (msg: SerializedMessage, emoji: string, currentlyMine: boolean) => void;
  onTogglePin?: (msg: SerializedMessage) => Promise<void> | void;
}

export function MessageItem({
  message,
  plaintext,
  replyPlaintext,
  isFirst,
  channelId,
  isServerOwner,
  onReply,
  onEdit,
  onDelete,
  onReact,
  onTogglePin,
}: MessageItemProps) {
  const { getValueFromToken } = useTideCloak();
  const { markUnread } = useUnread();
  const [showActions, setShowActions] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [showForward, setShowForward] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);

  const mySub = (getValueFromToken("sub") as string) ?? null;
  const isMine = mySub === message.authorId;
  const mentionsMe = !!mySub && message.mentions?.includes(mySub);
  const canDelete = isMine || !!isServerOwner;

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus();
      editRef.current.setSelectionRange(
        editRef.current.value.length,
        editRef.current.value.length,
      );
    }
  }, [editing]);

  // Externally-triggered edit (Up-arrow shortcut from the composer).
  useEffect(() => {
    const onEdit = (e: Event) => {
      const detail = (e as CustomEvent<{ messageId: string }>).detail;
      if (detail?.messageId !== message.id) return;
      if (plaintext === undefined) return;
      setDraft(plaintext);
      setEditing(true);
    };
    window.addEventListener("zl:edit-message", onEdit);
    return () => window.removeEventListener("zl:edit-message", onEdit);
  }, [message.id, plaintext]);

  const handleStartEdit = () => {
    if (plaintext === undefined) return;
    setDraft(plaintext);
    setEditing(true);
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setDraft("");
  };

  const handleSaveEdit = async () => {
    if (!onEdit) return;
    const trimmed = draft.trim();
    if (!trimmed || trimmed === plaintext) {
      handleCancelEdit();
      return;
    }
    setSavingEdit(true);
    try {
      await onEdit(message, trimmed);
      setEditing(false);
    } finally {
      setSavingEdit(false);
    }
  };

  const buildMenuActions = (): MenuAction[] => {
    const actions: MenuAction[] = [];
    if (plaintext !== undefined && onReply) {
      actions.push({
        key: "reply",
        label: "Reply",
        icon: MENU_ICONS.Reply,
        onClick: () => onReply(message, plaintext),
      });
    }
    actions.push({
      key: "react",
      label: "Add Reaction",
      icon: MENU_ICONS.Smile,
      onClick: () => setShowEmojiPicker(true),
    });
    if (isMine && plaintext !== undefined && onEdit) {
      actions.push({
        key: "edit",
        label: "Edit Message",
        icon: MENU_ICONS.Pencil,
        onClick: handleStartEdit,
      });
    }
    if (isServerOwner && onTogglePin) {
      actions.push({
        key: "pin",
        label: message.isPinned ? "Unpin Message" : "Pin Message",
        icon: message.isPinned ? MENU_ICONS.PinOff : MENU_ICONS.Pin,
        onClick: () => onTogglePin(message),
      });
    }
    if (plaintext !== undefined) {
      actions.push({
        key: "forward",
        label: "Forward",
        icon: MENU_ICONS.Reply,
        onClick: () => setShowForward(true),
      });
      const saved = isMessageSaved(message.id);
      actions.push({
        key: "save",
        label: saved ? "Unsave Message" : "Save Message",
        icon: MENU_ICONS.Pin,
        onClick: () => {
          const nowSaved = toggleSaveMessage({
            id: message.id,
            channelId: message.channelId,
            authorName:
              message.author.displayName || message.author.username || "?",
            plaintext,
            savedAt: 0,
          });
          showToast(nowSaved ? "Saved" : "Unsaved", "success");
        },
      });
    }
    actions.push({ key: "_divider", label: "", icon: MENU_ICONS.Hash, onClick: () => {} });
    if (plaintext !== undefined) {
      actions.push({
        key: "copy-text",
        label: "Copy Text",
        icon: MENU_ICONS.Copy,
        onClick: () => {
          navigator.clipboard
            ?.writeText(plaintext)
            .then(() => showToast("Copied text", "success"))
            .catch(() => showToast("Copy failed", "error"));
        },
      });
    }
    actions.push({
      key: "copy-link",
      label: "Copy Message Link",
      icon: MENU_ICONS.Copy,
      onClick: () => {
        const url = `${window.location.origin}${window.location.pathname}#msg-${message.id}`;
        navigator.clipboard
          ?.writeText(url)
          .then(() => showToast("Link copied", "success"))
          .catch(() => showToast("Copy failed", "error"));
      },
    });
    actions.push({
      key: "copy-id",
      label: "Copy Message ID",
      icon: MENU_ICONS.Hash,
      onClick: () => {
        navigator.clipboard
          ?.writeText(message.id)
          .then(() => showToast("ID copied", "success"))
          .catch(() => showToast("Copy failed", "error"));
      },
    });
    actions.push({
      key: "mark-unread",
      label: "Mark Unread",
      icon: MENU_ICONS.EyeOff,
      onClick: () => markUnread(message.channelId),
    });
    actions.push({
      key: "profile",
      label: "View Profile",
      icon: MENU_ICONS.User,
      onClick: () =>
        openProfile({
          id: message.authorId,
          username: message.author.username,
          displayName: message.author.displayName,
        }),
    });
    if (canDelete && onDelete) {
      actions.push({ key: "_divider2", label: "", icon: MENU_ICONS.Hash, onClick: () => {} });
      actions.push({
        key: "delete",
        label: "Delete Message",
        icon: MENU_ICONS.Trash2,
        onClick: () => onDelete(message),
        danger: true,
      });
    }
    return actions;
  };

  return (
    <div
      id={`msg-${message.id}`}
      className={cn(
        "group relative flex gap-3 rounded px-2 py-0.5 message-hover scroll-mt-16 transition-shadow",
        isFirst && "mt-4",
        mentionsMe && "border-l-2 border-yellow-400 bg-yellow-400/5",
      )}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => {
        setShowActions(false);
        setShowEmojiPicker(false);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuPos({ x: e.clientX, y: e.clientY });
      }}
    >
      {/* Avatar — only on first in group */}
      <div className="w-10 shrink-0">
        {isFirst && (
          <button
            type="button"
            onClick={() =>
              openProfile({
                id: message.authorId,
                username: message.author.username,
                displayName: message.author.displayName,
              })
            }
            className="rounded-full transition-transform hover:scale-105"
            title={message.author.displayName || message.author.username}
          >
            <Avatar user={message.author} size={40} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-hidden">
        {/* Reply preview */}
        {message.replyTo && (
          <button
            type="button"
            onClick={() => {
              const el = document.getElementById(`msg-${message.replyTo!.id}`);
              if (!el) return;
              el.scrollIntoView({ behavior: "smooth", block: "center" });
              el.classList.add("ring-2", "ring-brand", "rounded");
              setTimeout(
                () => el.classList.remove("ring-2", "ring-brand", "rounded"),
                1400,
              );
            }}
            className="mb-0.5 flex w-full items-center gap-1 truncate text-left text-xs text-muted hover:text-white"
            title="Jump to original message"
          >
            <CornerDownRight className="h-3 w-3 shrink-0" />
            <span className="font-medium text-white/80">
              {message.replyTo.author.displayName ||
                message.replyTo.author.username}
            </span>
            <span className="truncate opacity-70">
              {replyPlaintext ?? "…"}
            </span>
          </button>
        )}

        {isFirst && (
          <div className="flex items-baseline gap-2">
            <button
              type="button"
              onClick={() =>
                openProfile({
                  id: message.authorId,
                  username: message.author.username,
                  displayName: message.author.displayName,
                })
              }
              className="font-semibold text-white hover:underline"
            >
              {message.author.displayName || message.author.username}
            </button>
            <span
              className="text-xs text-muted"
              title={new Date(message.createdAt).toLocaleString()}
            >
              {formatTimestamp(new Date(message.createdAt))}
            </span>
            {message.editedAt && (
              <span className="text-xs text-muted">(edited)</span>
            )}
            {message.isPinned && (
              <span className="flex items-center gap-1 text-xs text-yellow-400">
                <Pin className="h-3 w-3" />
                pinned
              </span>
            )}
          </div>
        )}

        {/* Body — edit mode swaps in a textarea */}
        {editing ? (
          <div className="mt-1">
            <textarea
              ref={editRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSaveEdit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  handleCancelEdit();
                }
              }}
              disabled={savingEdit}
              rows={Math.min(8, draft.split("\n").length || 1)}
              className="w-full resize-none rounded-md bg-surface-100 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand"
            />
            <div className="mt-1 text-xs text-muted">
              <kbd className="font-mono">Esc</kbd> cancel ·{" "}
              <kbd className="font-mono">Enter</kbd> save
            </div>
          </div>
        ) : (
          <div className="text-sm leading-relaxed">
            {plaintext !== undefined ? (
              <span className="whitespace-pre-wrap text-[#dcddde]">
                <MessageContent text={plaintext} />
              </span>
            ) : message.content ? (
              <span className="flex items-center gap-1 italic text-muted">
                <Lock className="h-3 w-3" />
                Decrypting…
              </span>
            ) : (
              <span className="flex items-center gap-1 italic text-red-400">
                <AlertCircle className="h-3 w-3" />
                Unable to decrypt
              </span>
            )}
          </div>
        )}

        {/* Attachments — images render as a grid when 2+ in one message,
            other files as inline pill links. */}
        {(() => {
          const images = message.attachments.filter((a) =>
            a.mimeType?.startsWith("image/"),
          );
          const others = message.attachments.filter(
            (a) => !a.mimeType?.startsWith("image/"),
          );
          if (images.length === 0 && others.length === 0) return null;
          const gridCols =
            images.length === 1
              ? "grid-cols-1"
              : images.length === 2
                ? "grid-cols-2"
                : images.length === 3
                  ? "grid-cols-3"
                  : "grid-cols-2";
          return (
            <>
              {images.length > 0 && (
                <div
                  className={cn(
                    "mt-1 grid max-w-lg gap-1",
                    gridCols,
                    images.length === 1 && "max-w-md",
                  )}
                >
                  {images.map((att) => (
                    <button
                      key={att.id}
                      type="button"
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent("zl:lightbox", {
                            detail: { url: att.url, filename: att.filename },
                          }),
                        )
                      }
                      className="overflow-hidden rounded-md border border-surface-400/40 transition-opacity hover:opacity-90"
                      title={att.filename}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={att.url}
                        alt={att.filename}
                        className={cn(
                          "h-full w-full object-cover",
                          images.length === 1 ? "max-h-80 w-auto" : "max-h-48",
                        )}
                        loading="lazy"
                      />
                    </button>
                  ))}
                </div>
              )}
              {others.map((att) => (
                <a
                  key={att.id}
                  href={att.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 rounded bg-surface-400/50 px-2 py-1 text-xs text-brand hover:underline"
                >
                  📎 {att.filename}
                </a>
              ))}
            </>
          );
        })()}

        {/* Reactions */}
        {message.reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {message.reactions.map((r) => {
              const names = (r.users ?? [])
                .map((u) => u.displayName)
                .filter(Boolean);
              const tip = names.length
                ? `${names.join(", ")} reacted with ${r.emoji}`
                : `${r.count} reacted with ${r.emoji}`;
              return (
                <button
                  key={r.emoji}
                  onClick={() => onReact?.(message, r.emoji, r.me)}
                  title={tip}
                  className={cn(
                    "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
                    r.me
                      ? "border-brand/40 bg-brand/10 text-brand"
                      : "border-surface-400 bg-surface-400/30 text-muted hover:border-brand/40",
                  )}
                >
                  {r.emoji} {r.count}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Hover action bar */}
      {showActions && !editing && (
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-md border border-surface-400 bg-surface-200 px-1 py-0.5 shadow-md">
          <div className="relative">
            <button
              onClick={() => setShowEmojiPicker((v) => !v)}
              className="rounded p-1 text-muted hover:bg-surface-400/50 hover:text-white"
              title="Add reaction"
            >
              <Smile className="h-4 w-4" />
            </button>
            {showEmojiPicker && (
              <EmojiPicker
                placement="top"
                onClose={() => setShowEmojiPicker(false)}
                onPick={(emoji) => {
                  setShowEmojiPicker(false);
                  const mine = message.reactions.some(
                    (r) => r.emoji === emoji && r.me,
                  );
                  onReact?.(message, emoji, mine);
                }}
              />
            )}
          </div>

          <button
            onClick={() => plaintext !== undefined && onReply?.(message, plaintext)}
            disabled={plaintext === undefined}
            className="rounded p-1 text-muted hover:bg-surface-400/50 hover:text-white disabled:opacity-40"
            title="Reply"
          >
            <Reply className="h-4 w-4" />
          </button>

          {isMine && plaintext !== undefined && onEdit && (
            <button
              onClick={handleStartEdit}
              className="rounded p-1 text-muted hover:bg-surface-400/50 hover:text-white"
              title="Edit"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}

          {isServerOwner && onTogglePin && (
            <button
              onClick={() => onTogglePin(message)}
              className="rounded p-1 text-muted hover:bg-surface-400/50 hover:text-yellow-300"
              title={message.isPinned ? "Unpin" : "Pin"}
            >
              {message.isPinned ? (
                <PinOff className="h-4 w-4" />
              ) : (
                <Pin className="h-4 w-4" />
              )}
            </button>
          )}

          {canDelete && onDelete && (
            <button
              onClick={() => onDelete(message)}
              className="rounded p-1 text-muted hover:bg-red-500/20 hover:text-red-400"
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {menuPos && (
        <MessageContextMenu
          x={menuPos.x}
          y={menuPos.y}
          actions={buildMenuActions()}
          onClose={() => setMenuPos(null)}
        />
      )}

      {showForward && plaintext !== undefined && (
        <ForwardModal text={plaintext} onClose={() => setShowForward(false)} />
      )}
    </div>
  );
}

function formatTimestamp(d: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  if (that.getTime() === today.getTime()) return `Today at ${time}`;
  if (that.getTime() === yesterday.getTime()) return `Yesterday at ${time}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }) + ` at ${time}`;
}
