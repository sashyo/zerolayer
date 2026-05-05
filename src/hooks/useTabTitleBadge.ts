"use client";

/**
 * useTabTitleBadge — prefixes the document title with a "(n) " mention count.
 *
 * Reads `mentions` from UnreadProvider, sums the per-channel counts, and
 * mutates `document.title`. We remember the original title so we can restore
 * it cleanly when the count returns to zero.
 */
import { useEffect, useRef } from "react";
import { useUnread } from "@/components/providers/UnreadProvider";

export function useTabTitleBadge() {
  const { mentions } = useUnread();
  const originalRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (originalRef.current === null) {
      // Strip any pre-existing "(n) " prefix in case of HMR re-mount.
      originalRef.current = document.title.replace(/^\(\d+\)\s*/, "");
    }
    let total = 0;
    for (const n of mentions.values()) total += n;
    const base = originalRef.current ?? "ZeroLayer";
    document.title = total > 0 ? `(${total}) ${base}` : base;
  }, [mentions]);
}
