"use client";

/**
 * ChannelSearch — small popover that filters already-decrypted messages in
 * the current channel by substring match. Clicking a result scrolls the
 * chat to that message via the `msg-<id>` anchor and flashes a ring.
 *
 * Limitation: only searches what's currently loaded in memory. Older
 * messages need to be loaded via infinite scroll first. A future upgrade
 * could prefetch more on first open.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { SerializedMessage } from "@/types";

interface ChannelSearchProps {
  messages: SerializedMessage[];
  decryptedContent: Map<string, string>;
  onClose: () => void;
}

export function ChannelSearch({
  messages,
  decryptedContent,
  onClose,
}: ChannelSearchProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: Array<{ msg: SerializedMessage; plaintext: string }> = [];
    for (let i = messages.length - 1; i >= 0 && out.length < 50; i--) {
      const m = messages[i];
      const plain = decryptedContent.get(m.id);
      if (plain && plain.toLowerCase().includes(q)) {
        out.push({ msg: m, plaintext: plain });
      }
    }
    return out;
  }, [query, messages, decryptedContent]);

  const jump = (id: string) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-brand", "rounded");
    setTimeout(
      () => el.classList.remove("ring-2", "ring-brand", "rounded"),
      1400,
    );
    onClose();
  };

  return (
    <div className="absolute right-2 top-12 z-40 flex max-h-[60vh] w-80 flex-col overflow-hidden rounded-lg bg-surface-100 shadow-2xl ring-1 ring-black/40">
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
        <Search className="h-4 w-4 text-muted" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search this channel"
          className="flex-1 bg-transparent text-sm text-white placeholder-muted focus:outline-none"
        />
        <button
          onClick={onClose}
          className="rounded p-1 text-muted hover:bg-surface-200/60 hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {query.trim() === "" ? (
          <p className="px-4 py-6 text-center text-xs text-muted">
            Type to search loaded messages. Scroll up to load more history first.
          </p>
        ) : matches.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted">
            No matches in loaded messages.
          </p>
        ) : (
          matches.map(({ msg, plaintext }) => (
            <button
              key={msg.id}
              type="button"
              onClick={() => jump(msg.id)}
              className="block w-full border-b border-white/5 px-3 py-2 text-left text-sm hover:bg-surface-200/60"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-white">
                  {msg.author.displayName || msg.author.username}
                </span>
                <span className="text-[10px] text-muted">
                  {new Date(msg.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="truncate text-xs text-muted">
                {snippet(plaintext, query)}
              </p>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function snippet(text: string, q: string): string {
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text.slice(0, 80);
  const start = Math.max(0, idx - 24);
  const end = Math.min(text.length, idx + q.length + 40);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}
