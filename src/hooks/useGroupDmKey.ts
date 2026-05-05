"use client";

/**
 * useGroupDmKey — channelId-derived AES-GCM key for group DMs.
 *
 * NOT real E2EE: the server can derive the same key from the channel id.
 * It's a transport cipher / consistency layer so the message-storage
 * pipeline (which expects ciphertext content) keeps working until we wire
 * up per-member-wrapped epoch keys for group DMs.
 */
import { useCallback, useEffect, useState } from "react";
import { deriveGroupDmKey } from "@/lib/crypto";

export function useGroupDmKey(channelId: string | null) {
  const [epochKey, setEpochKey] = useState<CryptoKey | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    setLoading(true);
    deriveGroupDmKey(channelId)
      .then((k) => {
        if (!cancelled) setEpochKey(k);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  const getKey = useCallback(
    async (_version: number): Promise<CryptoKey | null> => epochKey,
    [epochKey],
  );

  return {
    epochKey,
    keyVersion: 1 as const,
    loading,
    hasMyWrap: !!epochKey,
    getKey,
  };
}
