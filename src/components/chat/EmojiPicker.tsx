"use client";

/**
 * EmojiPicker — searchable emoji grid. Used by both the message reaction
 * popover and the message composer. Lightweight (no third-party deps).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { searchEmojis } from "@/lib/emojis";

interface EmojiPickerProps {
  onPick: (emoji: string) => void;
  onClose?: () => void;
  placement?: "top" | "bottom";
}

export function EmojiPicker({
  onPick,
  onClose,
  placement = "bottom",
}: EmojiPickerProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => searchEmojis(query, 96), [query]);

  return (
    <div
      className={
        "absolute right-0 z-30 w-72 rounded-lg border border-surface-400 bg-surface-100 p-2 shadow-xl " +
        (placement === "top" ? "bottom-full mb-1" : "top-full mt-1")
      }
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center gap-2 rounded-md bg-surface-200 px-2">
        <Search className="h-3.5 w-3.5 text-muted" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose?.();
            if (e.key === "Enter" && results[0]) {
              e.preventDefault();
              onPick(results[0].e);
            }
          }}
          placeholder="Search emoji"
          className="flex-1 bg-transparent py-1.5 text-xs text-white placeholder-muted focus:outline-none"
        />
      </div>
      <div className="grid max-h-56 grid-cols-8 gap-0.5 overflow-y-auto">
        {results.map((entry) => (
          <button
            key={`${entry.e}-${entry.k[0]}`}
            type="button"
            onClick={() => onPick(entry.e)}
            className="rounded p-1 text-lg hover:bg-surface-400/60"
            title={entry.k[0]}
          >
            {entry.e}
          </button>
        ))}
        {results.length === 0 && (
          <p className="col-span-8 px-2 py-3 text-center text-xs text-muted">
            No matches.
          </p>
        )}
      </div>
    </div>
  );
}
