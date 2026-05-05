"use client";

/**
 * useChannelMutes — reactive view of the per-channel mute set. Re-renders
 * when the mute set changes in the same tab (custom event) or in another
 * tab (native storage event).
 */
import { useEffect, useState } from "react";
import { getMutedChannels } from "@/lib/channelMutes";

export function useChannelMutes(): Set<string> {
  const [muted, setMuted] = useState<Set<string>>(() => getMutedChannels());

  useEffect(() => {
    const refresh = () => setMuted(getMutedChannels());
    window.addEventListener("zl:mutes-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("zl:mutes-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return muted;
}
