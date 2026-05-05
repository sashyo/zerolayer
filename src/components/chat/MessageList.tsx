"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MessageItem } from "./MessageItem";
import { ChevronDown, Loader2 } from "lucide-react";
import { useUnread } from "@/components/providers/UnreadProvider";
import type { SerializedMessage } from "@/types";

interface MessageListProps {
  messages: SerializedMessage[];
  decryptedContent: Map<string, string>;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  channelId: string;
  channelName: string;
  isServerOwner?: boolean;
  onReply?: (msg: SerializedMessage, plaintext: string) => void;
  onEdit?: (msg: SerializedMessage, newPlaintext: string) => Promise<void> | void;
  onDelete?: (msg: SerializedMessage) => Promise<void> | void;
  onReact?: (msg: SerializedMessage, emoji: string, currentlyMine: boolean) => void;
  onTogglePin?: (msg: SerializedMessage) => Promise<void> | void;
}

export function MessageList({
  messages,
  decryptedContent,
  loading,
  hasMore,
  onLoadMore,
  channelId,
  channelName,
  isServerOwner,
  onReply,
  onEdit,
  onDelete,
  onReact,
  onTogglePin,
}: MessageListProps) {
  const { readMarkers } = useUnread();
  const readAnchor = readMarkers.get(channelId) ?? 0;
  const topRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const observer = useRef<IntersectionObserver | null>(null);
  // True when the viewport sits within ~80px of the bottom — controls both
  // whether we auto-scroll on new messages AND whether the floating jump
  // button is hidden.
  const [nearBottom, setNearBottom] = useState(true);

  const checkNearBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setNearBottom(distance < 80);
  };

  // Infinite scroll — load older messages when top is visible
  useEffect(() => {
    if (!hasMore) return;
    const el = topRef.current;
    if (!el) return;

    observer.current = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) onLoadMore(); },
      { threshold: 0.1 },
    );
    observer.current.observe(el);
    return () => observer.current?.disconnect();
  }, [hasMore, onLoadMore]);

  // When the messages array grows, auto-scroll only if user was already at
  // the bottom; otherwise leave their scroll position alone (Discord-style).
  useLayoutEffect(() => {
    if (!nearBottom) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, nearBottom]);

  // Deep-link via URL hash (`#msg-<id>`): once the messages list contains the
  // target, scroll to it and briefly highlight. We only fire once per hash.
  const lastHashHandledRef = useRef<string>("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash || lastHashHandledRef.current === hash) return;
    if (!hash.startsWith("#msg-")) return;
    const id = hash.slice(5);
    if (!messages.some((m) => m.id === id)) return;
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-brand", "rounded");
    setTimeout(
      () => el.classList.remove("ring-2", "ring-brand", "rounded"),
      1800,
    );
    lastHashHandledRef.current = hash;
  }, [messages]);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  if (loading && messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-400">
          <span className="text-2xl">#</span>
        </div>
        <p className="font-semibold text-white">Welcome to #{channelName}!</p>
        <p className="text-sm text-muted">
          This is the beginning of the #{channelName} channel.
        </p>
      </div>
    );
  }

  // Group consecutive messages by same author within 5 minutes
  const grouped = groupMessages(messages);

  return (
    <div
      ref={scrollRef}
      onScroll={checkNearBottom}
      className="relative flex flex-1 flex-col overflow-y-auto px-4 py-2"
    >
      {/* Load more sentinel */}
      <div ref={topRef} className="py-1" />
      {hasMore && loading && (
        <div className="flex justify-center py-2">
          <Loader2 className="h-4 w-4 animate-spin text-muted" />
        </div>
      )}

      {(() => {
        let lastDateKey: string | null = null;
        let readMarkerEmitted = readAnchor === 0;
        return grouped.flatMap((group) => {
          const groupKey = group.messages[0]?.id ?? "g";
          const firstMsgDate = new Date(group.messages[0].createdAt);
          const dateKey = firstMsgDate.toDateString();
          const showDateDivider = dateKey !== lastDateKey;
          lastDateKey = dateKey;
          const out: React.ReactNode[] = [];
          if (showDateDivider) {
            out.push(
              <DateDivider
                key={`d-${groupKey}`}
                label={formatDayLabel(firstMsgDate)}
              />,
            );
          }
          for (let idx = 0; idx < group.messages.length; idx++) {
            const msg = group.messages[idx];
            // Read-marker divider — first message strictly newer than the
            // anchor gets a "New" line above it. Only emit once per render.
            if (
              !readMarkerEmitted &&
              new Date(msg.createdAt).getTime() > readAnchor
            ) {
              out.push(<NewMarker key={`n-${msg.id}`} />);
              readMarkerEmitted = true;
            }
            out.push(
              <MessageItem
                key={msg.id}
                message={msg}
                plaintext={decryptedContent.get(msg.id)}
                replyPlaintext={
                  msg.replyTo ? decryptedContent.get(msg.replyTo.id) : undefined
                }
                isFirst={idx === 0}
                channelId={channelId}
                isServerOwner={isServerOwner}
                onReply={onReply}
                onEdit={onEdit}
                onDelete={onDelete}
                onReact={onReact}
                onTogglePin={onTogglePin}
              />,
            );
          }
          return out;
        });
      })()}

      {!nearBottom && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="sticky bottom-2 ml-auto mr-2 flex items-center gap-1.5 self-end rounded-full bg-brand px-3 py-1.5 text-xs font-medium text-white shadow-lg hover:bg-brand-hover"
          title="Jump to present"
        >
          <ChevronDown className="h-3.5 w-3.5" />
          Jump to present
        </button>
      )}
    </div>
  );
}

function NewMarker() {
  return (
    <div className="my-2 flex items-center gap-2 px-2">
      <div className="h-px flex-1 bg-red-500/40" />
      <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-400">
        New
      </span>
    </div>
  );
}

function DateDivider({ label }: { label: string }) {
  return (
    <div className="my-2 flex items-center gap-3 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
      <div className="h-px flex-1 bg-surface-100/40" />
      <span>{label}</span>
      <div className="h-px flex-1 bg-surface-100/40" />
    </div>
  );
}

function formatDayLabel(d: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (that.getTime() === today.getTime()) return "Today";
  if (that.getTime() === yesterday.getTime()) return "Yesterday";
  // Older than a week → include the year if not the current one.
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

// ── Grouping helper ───────────────────────────────────────────────────────────

interface MessageGroup {
  authorId: string;
  messages: SerializedMessage[];
}

function groupMessages(messages: SerializedMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const msg of messages) {
    const last = groups[groups.length - 1];
    const lastTs = last?.messages[last.messages.length - 1]?.createdAt;
    const gap =
      last &&
      last.authorId === msg.authorId &&
      lastTs &&
      new Date(msg.createdAt).getTime() - new Date(lastTs).getTime() < 5 * 60 * 1_000;

    if (gap) {
      last.messages.push(msg);
    } else {
      groups.push({ authorId: msg.authorId, messages: [msg] });
    }
  }
  return groups;
}
