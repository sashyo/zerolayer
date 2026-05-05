"use client";

/**
 * useDmKey — derives the shared AES-GCM key for a 1:1 DM with another user.
 *
 * Resolves the other user's public key (one fetch per peer, then cached for
 * the session) and derives `ECDH(myPriv, theirPub) → AES-256` via the
 * `deriveDmKey` helper. Returned in the same shape `ChatArea` expects so we
 * can reuse it for DM channels with no other changes:
 *
 *   { epochKey, keyVersion, loading, hasMyWrap, getKey, error }
 *
 * `keyVersion` is always 1 for DMs — there's no rotation. `getKey(version)`
 * just returns the same derived key regardless of version.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTideCloak } from "@tidecloak/nextjs";
import { useKeys } from "@/components/providers/KeysProvider";
import { deriveDmKey } from "@/lib/crypto";

export function useDmKey(otherUserId: string | null) {
  const { token } = useTideCloak();
  const { ready: keysReady, getPrivateKey } = useKeys();

  const [epochKey, setEpochKey] = useState<CryptoKey | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cachedRef = useRef<{ otherUserId: string; key: CryptoKey } | null>(null);

  useEffect(() => {
    if (!otherUserId || !token || !keysReady) return;

    // Reset state on peer change.
    if (cachedRef.current && cachedRef.current.otherUserId !== otherUserId) {
      cachedRef.current = null;
      setEpochKey(null);
    }
    if (cachedRef.current?.otherUserId === otherUserId) {
      setEpochKey(cachedRef.current.key);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await fetch(`/api/users/${otherUserId}/public-key`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            body.error ||
              "Other user has no public key yet — they need to log in once first",
          );
        }
        const { publicKey } = await res.json();
        const myPriv = await getPrivateKey();
        const k = await deriveDmKey(myPriv, publicKey);
        if (cancelled) return;
        cachedRef.current = { otherUserId, key: k };
        setEpochKey(k);
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Failed to derive DM key");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [otherUserId, token, keysReady, getPrivateKey]);

  // ChatArea expects a getKey(version) that resolves keys for any historical
  // version. DMs have no rotation, so all versions return the same key.
  const getKey = useCallback(
    async (_version: number): Promise<CryptoKey | null> => {
      if (epochKey) return epochKey;
      if (cachedRef.current?.otherUserId === otherUserId) {
        return cachedRef.current.key;
      }
      return null;
    },
    [epochKey, otherUserId],
  );

  return {
    epochKey,
    keyVersion: 1 as const,
    loading,
    hasMyWrap: !!epochKey,
    getKey,
    error,
  };
}
