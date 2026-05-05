"use client";

/**
 * useServerKey — fetches the caller's wrapped epoch keys for a server and
 * unwraps them on demand. Returns a `getKey(version)` function the message
 * hooks call when they need to encrypt or decrypt.
 *
 * Caching strategy:
 *   - One fetch per (serverId, token) pair. Wraps are immutable per version.
 *   - Unwrapped CryptoKeys held in a Map<version, CryptoKey> for the session.
 *   - Current version surfaced as `currentKeyVersion` for senders.
 *
 * Sending: call `getKey(currentKeyVersion)` and AES-GCM-encrypt with it.
 * Receiving: every message has `keyVersion`; call `getKey(msg.keyVersion)`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTideCloak } from "@tidecloak/nextjs";
import { useKeys } from "@/components/providers/KeysProvider";
import { unwrapEpochWithPrivate } from "@/lib/crypto";

interface Wrap {
  version: number;
  ephemeralPub: string;
  iv: string;
  wrappedKey: string;
}

interface State {
  loading: boolean;
  currentKeyVersion: number | null;
  hasMyWrap: boolean;
  error: string | null;
}

export function useServerKey(serverId: string | null) {
  const { token } = useTideCloak();
  const { ready: keysReady, getPrivateKey } = useKeys();

  const [state, setState] = useState<State>({
    loading: false,
    currentKeyVersion: null,
    hasMyWrap: false,
    error: null,
  });

  const wrapsRef = useRef<Map<number, Wrap>>(new Map());
  const keysRef = useRef<Map<number, CryptoKey>>(new Map());
  const fetchedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!serverId || !token || !keysReady) return;
    if (fetchedFor.current === serverId) return;

    setState((s) => ({ ...s, loading: true, error: null }));
    fetchedFor.current = serverId;
    wrapsRef.current = new Map();
    keysRef.current = new Map();

    (async () => {
      try {
        const res = await fetch(`/api/servers/${serverId}/keys`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`server-keys GET ${res.status}`);
        const data = await res.json();

        for (const w of data.wraps as Wrap[]) {
          wrapsRef.current.set(w.version, w);
        }
        const hasMyWrap = wrapsRef.current.has(data.currentKeyVersion);

        console.log("[useServerKey]", {
          serverId,
          currentKeyVersion: data.currentKeyVersion,
          wrapVersions: (data.wraps as Wrap[]).map((w) => w.version),
          hasMyWrap,
        });

        setState({
          loading: false,
          currentKeyVersion: data.currentKeyVersion,
          hasMyWrap,
          error: null,
        });
      } catch (err: any) {
        console.warn("[useServerKey] fetch failed", err);
        setState((s) => ({
          ...s,
          loading: false,
          error: err.message || "Failed to load server keys",
        }));
      }
    })();
  }, [serverId, token, keysReady]);

  /** Unwrap a specific version, caching the result for the session. */
  const getKey = useCallback(
    async (version: number): Promise<CryptoKey | null> => {
      if (keysRef.current.has(version)) return keysRef.current.get(version)!;
      const wrap = wrapsRef.current.get(version);
      if (!wrap) return null;

      const myPriv = await getPrivateKey();
      const epoch = await unwrapEpochWithPrivate(myPriv, {
        ephemeralPubB64: wrap.ephemeralPub,
        ivB64: wrap.iv,
        wrappedKeyB64: wrap.wrappedKey,
      });
      keysRef.current.set(version, epoch);
      return epoch;
    },
    [getPrivateKey],
  );

  return {
    ...state,
    getKey,
  };
}
