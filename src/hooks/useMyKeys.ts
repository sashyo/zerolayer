"use client";

/**
 * useMyKeys — owns the caller's ECDH keypair lifecycle.
 *
 *   1. On first authenticated render, fetch GET /api/users/me/keys.
 *   2. If no keypair exists yet, generate one and store:
 *      private bytes are wrapped via TideCloak self-encrypt (tag "x") so only
 *      this identity can ever decrypt them.
 *   3. Expose `publicKeyB64` (always available once bootstrapped) and a
 *      `getPrivateKey()` thunk that lazily self-decrypts on demand and caches
 *      the imported CryptoKey for the rest of the session.
 *
 * The plaintext private key never leaves this hook's closure: we hand callers
 * an opaque CryptoKey, suitable as input to `unwrapEpochWithPrivate`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTideCloak } from "@tidecloak/nextjs";
import {
  bytesToB64,
  b64ToBytes,
  generateUserKeyPair,
  importPrivateKey,
} from "@/lib/crypto";

interface State {
  publicKeyB64: string | null;
  ready: boolean;
  error: string | null;
}

export function useMyKeys() {
  const { token, IAMService, authenticated, isInitializing } = useTideCloak();
  const [state, setState] = useState<State>({
    publicKeyB64: null,
    ready: false,
    error: null,
  });

  // Cache the imported CryptoKey + the raw self-encrypted ciphertext so we can
  // self-decrypt again only when needed.
  // - cipherRef:    base64 of the TideCloak-self-encrypted PKCS8 (durable)
  // - privateKeyRef: imported ECDH CryptoKey (in-memory cache, with TTL)
  // - inflightRef:  in-flight self-decrypt promise — multiple parallel callers
  //                 share one SDK round-trip so we don't burn the enclave
  // - keyExpiryRef:  ms-epoch when the cached private key should be evicted
  const cipherRef = useRef<string | null>(null);
  const privateKeyRef = useRef<CryptoKey | null>(null);
  const inflightRef = useRef<Promise<CryptoKey> | null>(null);
  const keyExpiryRef = useRef<number>(0);
  const bootstrapping = useRef(false);

  // Clear the cached private key after this many ms of being unreferenced.
  // Re-decryption requires another `IAMService.doDecrypt` round-trip.
  const PRIVATE_KEY_TTL_MS = 5 * 60 * 1000;

  useEffect(() => {
    if (isInitializing || !authenticated || !token) return;
    if (bootstrapping.current) return;
    bootstrapping.current = true;

    (async () => {
      try {
        const res = await fetch("/api/users/me/keys", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`keys GET ${res.status}`);
        const { publicKey, encryptedPrivateKey } = await res.json();

        if (publicKey && encryptedPrivateKey) {
          cipherRef.current = encryptedPrivateKey;
          setState({ publicKeyB64: publicKey, ready: true, error: null });
          return;
        }

        // First-login bootstrap: generate, self-encrypt, store.
        const { publicKeyB64, privateKeyPkcs8 } = await generateUserKeyPair();

        // TideCloak doEncrypt accepts string or Uint8Array; we feed bytes.
        // Returns a base64 string we can hand back as-is.
        const encrypted = await IAMService.doEncrypt([
          { data: privateKeyPkcs8, tags: ["x"] },
        ]);
        const cipher = typeof encrypted[0] === "string"
          ? encrypted[0]
          : bytesToB64(encrypted[0]);

        const post = await fetch("/api/users/me/keys", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            publicKey: publicKeyB64,
            encryptedPrivateKey: cipher,
          }),
        });
        if (!post.ok) {
          const body = await post.text().catch(() => "");
          throw new Error(`keys POST ${post.status}: ${body}`);
        }

        cipherRef.current = cipher;
        setState({ publicKeyB64, ready: true, error: null });
      } catch (err: any) {
        console.error("[useMyKeys] bootstrap failed", err);
        setState({
          publicKeyB64: null,
          ready: false,
          error: err.message || "Failed to set up keys",
        });
      }
    })();
  }, [authenticated, token, isInitializing, IAMService]);

  /** Lazily unwrap the private key.
   *
   *  Caching:
   *   - First call self-decrypts via TideCloak and imports the PKCS8 bytes.
   *   - Subsequent calls within `PRIVATE_KEY_TTL_MS` return the cached
   *     CryptoKey. After expiry we re-decrypt.
   *   - Concurrent first-callers (e.g. parallel decryptBatch entries) share
   *     a single in-flight promise instead of triggering N round-trips.
   *
   *  Encoding:
   *   - We encrypted the PKCS8 bytes as Uint8Array, so the SDK's ciphertext is
   *     Uint8Array. We base64'd it for DB transport; we MUST reverse that
   *     before calling `doDecrypt` — passing the base64 string would trigger
   *     the SDK's "string-input" path and crash with atob errors.
   */
  const getPrivateKey = useCallback(async (): Promise<CryptoKey> => {
    if (privateKeyRef.current && Date.now() < keyExpiryRef.current) {
      // bump expiry on access so an active session keeps the key warm
      keyExpiryRef.current = Date.now() + PRIVATE_KEY_TTL_MS;
      return privateKeyRef.current;
    }
    if (inflightRef.current) return inflightRef.current;
    if (!cipherRef.current) throw new Error("Private key not bootstrapped yet");
    if (!IAMService) throw new Error("IAMService not available");

    const promise = (async () => {
      const cipherBytes = b64ToBytes(cipherRef.current!);
      const result = await IAMService.doDecrypt([
        { encrypted: cipherBytes, tags: ["x"] },
      ]);
      const raw = result[0];
      const pkcs8 =
        raw instanceof Uint8Array
          ? raw
          : typeof raw === "string"
            ? b64ToBytes(raw)
            : new Uint8Array(raw as any);

      const key = await importPrivateKey(pkcs8);
      privateKeyRef.current = key;
      keyExpiryRef.current = Date.now() + PRIVATE_KEY_TTL_MS;

      // Best-effort scrub. JS doesn't guarantee zeroing; we wipe the buffer
      // we held briefly so the bytes can't be recovered from a heap snapshot.
      try {
        pkcs8.fill(0);
      } catch {}
      return key;
    })();

    inflightRef.current = promise;
    try {
      return await promise;
    } finally {
      inflightRef.current = null;
    }
  }, [IAMService]);

  // Eviction timer — clears the cached CryptoKey after the TTL has lapsed.
  // We don't run this in a setInterval to avoid waking the tab; instead we
  // schedule a one-shot whenever the key is set, on the freshest expiry.
  useEffect(() => {
    if (!privateKeyRef.current) return;
    const ms = Math.max(0, keyExpiryRef.current - Date.now());
    const t = setTimeout(() => {
      if (Date.now() >= keyExpiryRef.current) {
        privateKeyRef.current = null;
      }
    }, ms);
    return () => clearTimeout(t);
    // Re-arm whenever a fresh decrypt updates `state.ready` or `keyExpiryRef`
    // (we rebind on bootstrap completion).
  }, [state.ready]);

  /** Clear local + server-side keys so the next render bootstraps fresh.
   *  Used as a recovery affordance when the stored ciphertext was produced by
   *  an incompatible code path (e.g. SDK upgrade or string/bytes mismatch). */
  const resetKeys = useCallback(async () => {
    if (!token) return;
    privateKeyRef.current = null;
    keyExpiryRef.current = 0;
    cipherRef.current = null;
    bootstrapping.current = false;
    setState({ publicKeyB64: null, ready: false, error: null });
    try {
      await fetch("/api/users/me/keys", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // ignore — DELETE may not be wired; reload will re-bootstrap if it isn't
    }
    window.location.reload();
  }, [token]);

  return {
    publicKeyB64: state.publicKeyB64,
    ready: state.ready,
    error: state.error,
    getPrivateKey,
    resetKeys,
  };
}
