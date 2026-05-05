"use client";

/**
 * useEpochKey — convenience wrapper that resolves the *current* server epoch
 * key as an unwrapped CryptoKey. Combines useServerKey (which knows the
 * version + holds wraps) with the on-demand unwrap.
 *
 * Used by ChatArea and VoiceRoom to gate sending/joining on key availability.
 */
import { useEffect, useState } from "react";
import { useServerKey } from "./useServerKey";

export function useEpochKey(serverId: string | null) {
  const serverKey = useServerKey(serverId);
  const [epochKey, setEpochKey] = useState<CryptoKey | null>(null);
  const [unwrapError, setUnwrapError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setUnwrapError(null);
    if (serverKey.currentKeyVersion == null || !serverKey.hasMyWrap) {
      setEpochKey(null);
      return;
    }
    serverKey
      .getKey(serverKey.currentKeyVersion)
      .then((k) => {
        if (!cancelled) setEpochKey(k);
      })
      .catch((err: any) => {
        console.error("[useEpochKey] unwrap failed", err);
        if (!cancelled)
          setUnwrapError(err?.message || "Failed to unlock server key");
      });
    return () => {
      cancelled = true;
    };
  }, [serverKey.currentKeyVersion, serverKey.hasMyWrap, serverKey.getKey]);

  return {
    epochKey,
    keyVersion: serverKey.currentKeyVersion,
    loading: serverKey.loading,
    hasMyWrap: serverKey.hasMyWrap,
    error: serverKey.error ?? unwrapError,
    // Pass-through so consumers that need historical-version decrypt can
    // reach into the per-version cache (used by useMessages).
    getKey: serverKey.getKey,
  };
}
