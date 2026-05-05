"use client";

/**
 * MessageInput — composer with keypair-mode E2EE.
 *
 *   1. Caller passes the unwrapped server epoch key + its version.
 *   2. We AES-GCM encrypt the typed text and POST the base64(IV‖CT) plus the
 *      key version. Server stores ciphertext as-is.
 *   3. Socket broadcast carries the same ciphertext for live recipients.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ChangeEvent,
} from "react";
import { Send, Paperclip, Lock, AlertTriangle, Loader2, Smile, X, CornerDownRight } from "lucide-react";
import { useTideCloak } from "@tidecloak/nextjs";
import { useRealtimeChannel } from "@/components/providers/RealtimeProvider";
import { encryptMessage } from "@/lib/crypto";
import { cn } from "@/lib/utils";
import { EmojiPicker } from "./EmojiPicker";
import { searchEmojis } from "@/lib/emojis";
import { usePresence } from "@/components/providers/PresenceProvider";
import type { SerializedMessage, SerializedMember } from "@/types";

interface MessageInputProps {
  channelId: string;
  channelName: string;
  epochKey: CryptoKey | null;       // unwrapped epoch for the current server
  keyVersion: number | null;        // version of the epoch above
  keyLoading: boolean;
  onTyping: () => void;
  onStopTyping: () => void;
  onSentLocal?: (msg: any, plaintext?: string) => void;
  replyTarget?: { msg: SerializedMessage; plaintext: string } | null;
  onClearReply?: () => void;
  members?: SerializedMember[];
  /** Up-arrow on an empty composer triggers this so the parent can find
   *  the user's most recent message and dispatch an edit. */
  onEditLast?: () => void;
}

/**
 * Detect an active `@…` token at the caret. Returns the start index of the
 * `@` and the query (text after it, no spaces) when the caret is inside such
 * a token; otherwise null. The `@` must be at the start of input or right
 * after whitespace so we don't catch emails like foo@bar.
 */
/**
 * Slash commands transform the typed text before encryption. Each command
 * matches the literal first token (e.g. `/me wave`) and rewrites the line.
 * Commands run client-side only — recipients see the rewritten plaintext,
 * the server never knew the user typed `/`.
 */
const SLASH_COMMANDS: Array<{
  cmd: string;
  hint: string;
  apply: (rest: string, ctx: { username: string }) => string;
}> = [
  {
    cmd: "/me",
    hint: "* describes an action *",
    apply: (rest, { username }) =>
      `*${username || "me"} ${rest.trim() || "…"}*`,
  },
  {
    cmd: "/shrug",
    hint: "Append ¯\\_(ツ)_/¯",
    apply: (rest) => `${rest.trim()} ¯\\_(ツ)_/¯`.trim(),
  },
  {
    cmd: "/tableflip",
    hint: "Append (╯°□°)╯︵ ┻━┻",
    apply: (rest) => `${rest.trim()} (╯°□°)╯︵ ┻━┻`.trim(),
  },
  {
    cmd: "/unflip",
    hint: "Append ┬─┬ ノ( ゜-゜ノ)",
    apply: (rest) => `${rest.trim()} ┬─┬ ノ( ゜-゜ノ)`.trim(),
  },
  {
    cmd: "/spoiler",
    hint: "Wrap in ||spoiler||",
    apply: (rest) => `||${rest.trim() || "…"}||`,
  },
  {
    cmd: "/code",
    hint: "Wrap in ``` block ```",
    apply: (rest) => "```\n" + rest + "\n```",
  },
];

function applySlashCommand(text: string, ctx: { username: string }): string {
  if (!text.startsWith("/")) return text;
  const space = text.indexOf(" ");
  const head = (space === -1 ? text : text.slice(0, space)).toLowerCase();
  const rest = space === -1 ? "" : text.slice(space + 1);
  const cmd = SLASH_COMMANDS.find((c) => c.cmd === head);
  return cmd ? cmd.apply(rest, ctx) : text;
}

function extractMentionUserIds(text: string, members: SerializedMember[]): string[] {
  if (members.length === 0) return [];
  const byUsername = new Map<string, string>();
  for (const m of members) {
    if (m.user.username) byUsername.set(m.user.username.toLowerCase(), m.userId);
  }
  const ids = new Set<string>();
  const re = /(^|\s|\()@([A-Za-z0-9_.-]{1,32})/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const id = byUsername.get(match[2].toLowerCase());
    if (id) ids.add(id);
  }
  return Array.from(ids);
}

function findMentionToken(text: string, caret: number): { start: number; query: string } | null {
  let i = caret - 1;
  while (i >= 0) {
    const c = text[i];
    if (c === "@") {
      const before = i === 0 ? " " : text[i - 1];
      if (/\s/.test(before)) return { start: i, query: text.slice(i + 1, caret) };
      return null;
    }
    if (/\s/.test(c)) return null;
    i--;
  }
  return null;
}

export function MessageInput({
  channelId,
  channelName,
  epochKey,
  keyVersion,
  keyLoading,
  onTyping,
  onStopTyping,
  onSentLocal,
  replyTarget,
  onClearReply,
  members = [],
  onEditLast,
}: MessageInputProps) {
  const { token, getValueFromToken } = useTideCloak();
  const channel = useRealtimeChannel(channelId ? `messages:${channelId}` : null);
  const myUsername = (getValueFromToken("preferred_username") as string) ?? "";
  const { statuses: onlineStatuses } = usePresence();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Prefill from a Forward action: ForwardModal navigates here, then fires
  // `zl:prefill-composer` shortly after. We append to whatever's already in
  // the box so a draft isn't clobbered.
  useEffect(() => {
    const onPrefill = (e: Event) => {
      const detail = (e as CustomEvent<{ text?: string }>).detail;
      if (!detail?.text) return;
      setText((cur) => (cur ? cur + "\n" + detail.text : detail.text!));
      queueMicrotask(() => {
        textareaRef.current?.focus();
      });
    };
    window.addEventListener("zl:prefill-composer", onPrefill);
    return () => window.removeEventListener("zl:prefill-composer", onPrefill);
  }, []);

  // Mention autocomplete state. `mention` is the active token's location +
  // current query; `mentionIndex` is the highlighted suggestion.
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [showEmoji, setShowEmoji] = useState(false);

  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current;
    if (!el) {
      setText((t) => t + emoji);
      return;
    }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    queueMicrotask(() => {
      if (!textareaRef.current) return;
      const pos = start + emoji.length;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(pos, pos);
    });
  };

  const mentionMatches = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return members
      .filter((m) => {
        const u = m.user.username?.toLowerCase() ?? "";
        const d = m.user.displayName?.toLowerCase() ?? "";
        return u.startsWith(q) || d.startsWith(q);
      })
      .slice(0, 8);
  }, [mention, members]);

  // Slash-command autocomplete: show matching commands while the user types
  // them, but only when the entire message is the (in-progress) command —
  // we don't want to interpret a `/` mid-sentence as a command.
  const [slashIndex, setSlashIndex] = useState(0);
  const slashMatches = useMemo(() => {
    if (!text.startsWith("/")) return [];
    const head = text.split(/\s/, 1)[0].toLowerCase();
    if (!head.startsWith("/")) return [];
    return SLASH_COMMANDS.filter((c) => c.cmd.startsWith(head));
  }, [text]);
  const showSlashMenu = slashMatches.length > 0 && text.length > 0 && !text.includes(" ");

  // :shortcode: emoji token at caret — same shape as the @mention popover.
  const [emojiToken, setEmojiToken] = useState<{ start: number; query: string } | null>(null);
  const [emojiTokenIndex, setEmojiTokenIndex] = useState(0);
  const emojiTokenMatches = useMemo(() => {
    if (!emojiToken) return [];
    return searchEmojis(emojiToken.query, 6);
  }, [emojiToken]);

  const updateEmojiTokenFromCaret = (el: HTMLTextAreaElement) => {
    const caret = el.selectionStart ?? el.value.length;
    const value = el.value;
    let i = caret - 1;
    while (i >= 0) {
      const c = value[i];
      if (c === ":") {
        const before = i === 0 ? " " : value[i - 1];
        if (/\s/.test(before) || i === 0) {
          const query = value.slice(i + 1, caret);
          // Require at least one alphanumeric so a lone `:` doesn't pop a list.
          if (query && /^[A-Za-z0-9_+-]+$/.test(query)) {
            setEmojiToken({ start: i, query });
            setEmojiTokenIndex(0);
            return;
          }
        }
        setEmojiToken(null);
        return;
      }
      if (/\s/.test(c)) break;
      i--;
    }
    setEmojiToken(null);
  };

  const insertEmojiToken = (emoji: string) => {
    if (!emojiToken || !textareaRef.current) return;
    const el = textareaRef.current;
    const before = text.slice(0, emojiToken.start);
    const after = text.slice(el.selectionStart ?? text.length);
    const next = before + emoji + after;
    setText(next);
    setEmojiToken(null);
    queueMicrotask(() => {
      if (!textareaRef.current) return;
      const pos = before.length + emoji.length;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(pos, pos);
    });
  };

  const ready = !!epochKey && keyVersion != null;

  const updateMentionFromCaret = (el: HTMLTextAreaElement) => {
    const caret = el.selectionStart ?? el.value.length;
    const tok = findMentionToken(el.value, caret);
    setMention(tok);
    setMentionIndex(0);
  };

  const insertMention = (username: string) => {
    if (!mention || !textareaRef.current) return;
    const el = textareaRef.current;
    const before = text.slice(0, mention.start);
    const after = text.slice((el.selectionStart ?? text.length));
    const inserted = `@${username} `;
    const next = before + inserted + after;
    setText(next);
    setMention(null);
    queueMicrotask(() => {
      if (!textareaRef.current) return;
      const pos = before.length + inserted.length;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(pos, pos);
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        200,
      )}px`;
    });
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    onTyping();
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    updateMentionFromCaret(el);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (emojiToken && emojiTokenMatches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setEmojiTokenIndex((i) => (i + 1) % emojiTokenMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setEmojiTokenIndex(
          (i) => (i - 1 + emojiTokenMatches.length) % emojiTokenMatches.length,
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertEmojiToken(emojiTokenMatches[emojiTokenIndex].e);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setEmojiToken(null);
        return;
      }
    }
    if (mention && mentionMatches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex(
          (i) => (i - 1 + mentionMatches.length) % mentionMatches.length,
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(mentionMatches[mentionIndex].user.username);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return;
      }
    }
    if (showSlashMenu) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % slashMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex(
          (i) => (i - 1 + slashMatches.length) % slashMatches.length,
        );
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const sel = slashMatches[slashIndex];
        setText(sel.cmd + " ");
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    // Up-arrow on an empty composer: edit the user's most recent message.
    // Skip if any popup is consuming arrow keys, and skip if the user has
    // typed anything (we'd be hijacking caret movement otherwise).
    if (
      e.key === "ArrowUp" &&
      text === "" &&
      !mention &&
      !showSlashMenu &&
      !emojiToken &&
      onEditLast
    ) {
      e.preventDefault();
      onEditLast();
    }
  };

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending || !token) return;
    if (!epochKey || keyVersion == null) {
      setError("No server key available — try refreshing or ask the owner to reshare keys");
      return;
    }

    setSending(true);
    setError(null);
    onStopTyping();

    try {
      const transformed = applySlashCommand(trimmed, { username: myUsername });
      const content = await encryptMessage(epochKey, transformed);

      // Resolve @username tokens → userIds so recipients can show mention
      // notifications without the server reading plaintext. Replies also
      // auto-add the original author so they get pinged like in Discord.
      const mentionedIds = extractMentionUserIds(transformed, members);
      if (replyTarget) {
        const replyAuthor = replyTarget.msg.authorId;
        if (replyAuthor && !mentionedIds.includes(replyAuthor)) {
          mentionedIds.push(replyAuthor);
        }
      }
      // @everyone expands to all server members; @here expands to whoever's
      // currently online. The sender's local copy of `members` is the source
      // of truth — server doesn't peek at plaintext content.
      if (/(^|\s|\()@everyone\b/.test(transformed)) {
        for (const m of members) {
          if (!mentionedIds.includes(m.userId)) mentionedIds.push(m.userId);
        }
      } else if (/(^|\s|\()@here\b/.test(transformed)) {
        for (const m of members) {
          const status = onlineStatuses?.get(m.userId);
          if (status && status !== "OFFLINE" && !mentionedIds.includes(m.userId)) {
            mentionedIds.push(m.userId);
          }
        }
      }

      const res = await fetch(`/api/channels/${channelId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          content,
          keyVersion,
          type: "TEXT",
          replyToId: replyTarget?.msg.id,
          mentions: mentionedIds,
        }),
      });

      if (!res.ok) {
        const { error: msg } = await res.json();
        throw new Error(msg || "Failed to send");
      }

      const { message } = await res.json();
      // Optimistic insert: surface the message locally with the plaintext we
      // already have. The dedup guard in onNew will skip the broadcast copy.
      onSentLocal?.(message, transformed);
      channel?.send({
        type: "broadcast",
        event: "message:new",
        payload: message,
      });

      setText("");
      setMention(null);
      onClearReply?.();
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } catch (err: any) {
      setError(err.message || "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  const uploadFile = async (file: File) => {
    await uploadFiles([file]);
  };

  /** Upload N files in parallel and post a single message that bundles all
   *  resulting attachments — Discord-style grid render falls out of this. */
  const uploadFiles = async (files: File[]) => {
    if (files.length === 0 || !token) return;
    if (!epochKey || keyVersion == null) {
      setError("No server key available for attachment metadata");
      return;
    }
    try {
      const ids = await Promise.all(
        files.map(async (file) => {
          const fd = new FormData();
          fd.append("file", file);
          fd.append("channelId", channelId);
          const res = await fetch("/api/upload", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: fd,
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `Upload failed (${res.status})`);
          }
          const { id } = await res.json();
          return { id, name: file.name };
        }),
      );
      const caption =
        ids.length === 1 ? `📎 ${ids[0].name}` : `📎 ${ids.length} attachments`;
      const content = await encryptMessage(epochKey, caption);
      const msgRes = await fetch(`/api/channels/${channelId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          content,
          keyVersion,
          type: "FILE",
          attachmentIds: ids.map((x) => x.id),
        }),
      });
      const { message } = await msgRes.json();
      onSentLocal?.(message, caption);
      channel?.send({
        type: "broadcast",
        event: "message:new",
        payload: message,
      });
    } catch (err: any) {
      setError(err.message || "Upload failed");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) await uploadFiles(files);
  };

  // Drag-drop file upload — also expose a hover state so we can highlight the
  // composer while a file is being dragged over it. We count enter/leave
  // because nested children fire dragleave when entering them.
  const dragCounter = useRef(0);
  const [dragOver, setDragOver] = useState(false);

  const handleDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragCounter.current += 1;
    setDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDragOver(false);
  };
  const handleDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
  };
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) await uploadFiles(files);
  };

  return (
    <div
      className="shrink-0 px-4 pb-6 pt-0"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {replyTarget && (
        <div className="mb-1 flex items-center gap-2 rounded-t-md border border-b-0 border-surface-100/40 bg-surface-100/60 px-3 py-1.5 text-xs text-muted">
          <CornerDownRight className="h-3 w-3 shrink-0" />
          <span className="shrink-0">
            Replying to{" "}
            <span className="font-semibold text-white">
              {replyTarget.msg.author.displayName ||
                replyTarget.msg.author.username}
            </span>
          </span>
          <span className="truncate opacity-70">{replyTarget.plaintext}</span>
          <button
            onClick={onClearReply}
            className="ml-auto shrink-0 rounded p-0.5 text-muted hover:bg-surface-100 hover:text-white"
            title="Cancel reply"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {!keyLoading && !epochKey && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-yellow-500/10 px-3 py-2 text-xs text-yellow-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>
            No server key available for your account yet. Ask the owner to add
            you (or wait a moment after joining).
          </span>
        </div>
      )}

      {error && (
        <div className="mb-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      <div
        className={cn(
          "relative flex items-end gap-2 rounded-lg bg-surface-400 px-4 py-2 transition-shadow",
          dragOver && "ring-2 ring-brand ring-offset-2 ring-offset-surface-300",
        )}
      >
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-brand/10 text-sm font-semibold text-brand">
            Drop to upload
          </div>
        )}
        {emojiToken && emojiTokenMatches.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 mb-1 overflow-hidden rounded-lg bg-surface-100 shadow-xl ring-1 ring-black/40">
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
              Emoji matching <span className="text-white">:{emojiToken.query}</span>
            </div>
            {emojiTokenMatches.map((m, idx) => (
              <button
                key={`${m.e}-${m.k[0]}`}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertEmojiToken(m.e);
                }}
                onMouseEnter={() => setEmojiTokenIndex(idx)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                  idx === emojiTokenIndex
                    ? "bg-brand/20 text-white"
                    : "text-muted hover:bg-surface-200/60 hover:text-white",
                )}
              >
                <span className="text-lg">{m.e}</span>
                <span className="text-xs opacity-80">:{m.k[0]}:</span>
              </button>
            ))}
          </div>
        )}
        {showSlashMenu && (
          <div className="absolute bottom-full left-0 right-0 mb-1 overflow-hidden rounded-lg bg-surface-100 shadow-xl ring-1 ring-black/40">
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
              Slash commands
            </div>
            {slashMatches.map((c, idx) => (
              <button
                key={c.cmd}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setText(c.cmd + " ");
                  textareaRef.current?.focus();
                }}
                onMouseEnter={() => setSlashIndex(idx)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                  idx === slashIndex
                    ? "bg-brand/20 text-white"
                    : "text-muted hover:bg-surface-200/60 hover:text-white",
                )}
              >
                <span className="font-mono text-white">{c.cmd}</span>
                <span className="ml-auto text-xs opacity-70">{c.hint}</span>
              </button>
            ))}
          </div>
        )}
        {mention && mentionMatches.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 mb-1 max-h-64 overflow-y-auto rounded-lg bg-surface-100 shadow-xl ring-1 ring-black/40">
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
              Members matching <span className="text-white">@{mention.query}</span>
            </div>
            {mentionMatches.map((m, idx) => {
              const display = m.user.displayName || m.user.username;
              const initials = display.slice(0, 2).toUpperCase();
              return (
                <button
                  key={m.userId}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertMention(m.user.username);
                  }}
                  onMouseEnter={() => setMentionIndex(idx)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                    idx === mentionIndex
                      ? "bg-brand/20 text-white"
                      : "text-muted hover:bg-surface-200/60 hover:text-white",
                  )}
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white">
                    {initials}
                  </div>
                  <span className="truncate">
                    <span className="font-medium text-white">{display}</span>
                    <span className="ml-1 opacity-60">@{m.user.username}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <button
          onClick={() => fileRef.current?.click()}
          className="mb-2 text-muted hover:text-white"
          title="Attach file"
        >
          <Paperclip className="h-5 w-5" />
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileUpload}
          accept="image/*,application/pdf,text/*,video/mp4,audio/*"
        />

        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onKeyUp={(e) => {
            updateMentionFromCaret(e.currentTarget);
            updateEmojiTokenFromCaret(e.currentTarget);
          }}
          onClick={(e) => {
            updateMentionFromCaret(e.currentTarget);
            updateEmojiTokenFromCaret(e.currentTarget);
          }}
          onBlur={() => {
            setMention(null);
            setEmojiToken(null);
          }}
          onPaste={(e) => {
            // Pull any image off the clipboard and upload it directly. Other
            // formats (text/plain) keep the browser's default paste behaviour.
            const items = Array.from(e.clipboardData?.items ?? []);
            const imageItem = items.find((i) => i.kind === "file" && i.type.startsWith("image/"));
            if (!imageItem) return;
            const file = imageItem.getAsFile();
            if (!file) return;
            e.preventDefault();
            const ext = file.type.split("/")[1] || "png";
            const named = new File(
              [file],
              file.name && file.name !== "image.png" ? file.name : `pasted-${Date.now()}.${ext}`,
              { type: file.type },
            );
            void uploadFile(named);
          }}
          placeholder={`Message #${channelName}${ready ? " (E2EE)" : ""}`}
          rows={1}
          disabled={sending || !ready}
          className={cn(
            "flex-1 resize-none bg-transparent py-2 text-sm text-white placeholder-muted focus:outline-none",
            "max-h-[200px]",
          )}
        />

        <div className="relative">
          <button
            type="button"
            onClick={() => setShowEmoji((v) => !v)}
            className="mb-2 text-muted hover:text-white"
            title="Emoji"
          >
            <Smile className="h-5 w-5" />
          </button>
          {showEmoji && (
            <EmojiPicker
              placement="top"
              onClose={() => setShowEmoji(false)}
              onPick={(emoji) => {
                insertEmoji(emoji);
                setShowEmoji(false);
              }}
            />
          )}
        </div>

        <button
          onClick={handleSend}
          disabled={!text.trim() || sending || !ready}
          className="mb-1 rounded p-1.5 text-muted hover:bg-surface-100 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          title={ready ? "Send (E2EE)" : "Server key not ready"}
        >
          {sending ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : ready ? (
            <Lock className="h-5 w-5 text-green-400" />
          ) : (
            <Send className="h-5 w-5" />
          )}
        </button>
      </div>
    </div>
  );
}
