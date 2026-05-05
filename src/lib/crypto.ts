"use client";

/**
 * Browser-side E2EE primitives for ZeroLayer.
 *
 *   User keypair  : ECDH P-256 (private wrapped via TideCloak self-encrypt)
 *   Server epoch  : AES-GCM-256, fresh per server, rotated on member-leave
 *   Wrap          : ECDH-ES — generate ephemeral keypair, derive AES-GCM-256
 *                   from ECDH(eph_priv, recipient_pub) via WebCrypto's built-in
 *                   "deriveKey", encrypt the raw epoch bytes
 *   Message       : AES-GCM(epoch, plaintext)  →  base64( iv(12) ‖ ciphertext )
 *
 * Plaintext private/epoch keys never leave this file. Callers receive opaque
 * CryptoKey handles or already-encrypted ciphertext bytes.
 *
 * KEY-CHAIN ROOT
 * ──────────────
 * Every persisted secret in this system terminates at TideCloak self-encrypt:
 *
 *   TideCloak self-encrypt (_tide_x.selfencrypt voucher, identity-bound)
 *     │
 *     ├─► User PKCS8 private key (encryptedPrivateKey on User row)
 *     │     │
 *     │     └─► ECDH-unwrapped server epoch keys (ServerKey wraps)
 *     │           │
 *     │           ├─► AES-GCM message ciphertexts
 *     │           ├─► HMAC-SHA-256 over WebRTC SDP (voice signaling MAC)
 *     │           └─► (DTLS-SRTP keys are per-session WebRTC negotiation,
 *     │                 ephemeral — not persisted, not in this chain)
 *     │
 *     └─► Owner epoch vault (Server.ownerEpochVault, per-version, owner-only)
 *           Identity-rooted owner recovery: same root, parallel branch.
 *
 * Operationally: every NEW server epoch is BOTH self-encrypted (owner-only
 * vault) AND ECDH-wrapped per member. Generation flow always starts with
 * `selfEncryptSeed` so the first persistence call after entropy is identity-
 * attested. See `generateSelfEncryptedEpoch` below.
 */

const EC_PARAMS = { name: "ECDH" as const, namedCurve: "P-256" as const };
const AES_PARAMS = { name: "AES-GCM" as const, length: 256 };

// ── encoders ─────────────────────────────────────────────────────────────────

export function bytesToB64(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
  return btoa(bin);
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

// ── User keypair ─────────────────────────────────────────────────────────────

export interface RawUserKeyPair {
  publicKeyB64: string;       // SPKI DER, base64
  privateKeyPkcs8: Uint8Array; // raw bytes — caller must wrap immediately
}

/** Generate a fresh ECDH keypair and export it. Caller is responsible for
 *  encrypting `privateKeyPkcs8` (we use TideCloak self-encrypt). */
export async function generateUserKeyPair(): Promise<RawUserKeyPair> {
  const kp = await crypto.subtle.generateKey(EC_PARAMS, true, ["deriveKey"]);
  const pub = await crypto.subtle.exportKey("spki", kp.publicKey);
  const priv = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
  return {
    publicKeyB64: bytesToB64(pub),
    privateKeyPkcs8: new Uint8Array(priv),
  };
}

export async function importPublicKey(spkiB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    b64ToBytes(spkiB64) as unknown as BufferSource,
    EC_PARAMS,
    true,
    [],
  );
}

export async function importPrivateKey(pkcs8: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    pkcs8 as unknown as BufferSource,
    EC_PARAMS,
    false,
    ["deriveKey"],
  );
}

// ── Server epoch key ─────────────────────────────────────────────────────────

/** Fresh AES-GCM-256 key. Browser keeps the CryptoKey handle; raw bytes only
 *  exposed when wrapping for a recipient. */
export async function generateEpochKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(AES_PARAMS, true, ["encrypt", "decrypt"]);
}

export interface WrappedEpoch {
  ephemeralPubB64: string;
  ivB64: string;
  wrappedKeyB64: string;
}

/** Wrap a server epoch key for a recipient public key (ECDH-ES). */
export async function wrapEpochForRecipient(
  epochKey: CryptoKey,
  recipientPubB64: string,
): Promise<WrappedEpoch> {
  const recipientPub = await importPublicKey(recipientPubB64);

  const eph = await crypto.subtle.generateKey(EC_PARAMS, true, ["deriveKey"]);

  const sharedKey = await crypto.subtle.deriveKey(
    { name: "ECDH", public: recipientPub },
    eph.privateKey,
    AES_PARAMS,
    false,
    ["encrypt"],
  );

  const epochRaw = await crypto.subtle.exportKey("raw", epochKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    sharedKey,
    epochRaw,
  );

  const ephPub = await crypto.subtle.exportKey("spki", eph.publicKey);

  return {
    ephemeralPubB64: bytesToB64(ephPub),
    ivB64: bytesToB64(iv),
    wrappedKeyB64: bytesToB64(wrapped),
  };
}

/** Unwrap a server epoch key with the caller's private key. */
export async function unwrapEpochWithPrivate(
  myPriv: CryptoKey,
  wrap: WrappedEpoch,
): Promise<CryptoKey> {
  const ephPub = await importPublicKey(wrap.ephemeralPubB64);
  const sharedKey = await crypto.subtle.deriveKey(
    { name: "ECDH", public: ephPub },
    myPriv,
    AES_PARAMS,
    false,
    ["decrypt"],
  );
  const epochRaw = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64ToBytes(wrap.ivB64) as unknown as BufferSource },
    sharedKey,
    b64ToBytes(wrap.wrappedKeyB64) as unknown as BufferSource,
  );
  // extractable:true so the owner can re-wrap this epoch for new recipients
  // (Grant access flow / AddMember). Non-extractable would raise the bar
  // against post-XSS key exfiltration, but the raw bytes were just in memory
  // during the unwrap anyway, so the marginal benefit doesn't pay for the
  // operational cost of "can't grant access".
  return crypto.subtle.importKey(
    "raw",
    epochRaw,
    AES_PARAMS,
    true,
    ["encrypt", "decrypt"],
  );
}

// ── Messages ─────────────────────────────────────────────────────────────────

/** Encrypt UTF-8 text with the server epoch key. Returns base64(IV‖CT). */
export async function encryptMessage(
  epoch: CryptoKey,
  plaintext: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    epoch,
    enc.encode(plaintext),
  );
  const out = new Uint8Array(iv.byteLength + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), iv.byteLength);
  return bytesToB64(out);
}

/** Inverse of encryptMessage. Throws if the ciphertext is corrupt or the wrong
 *  key is supplied (AES-GCM verifies the auth tag internally). */
export async function decryptMessage(
  epoch: CryptoKey,
  ivCtB64: string,
): Promise<string> {
  const buf = b64ToBytes(ivCtB64);
  const iv = buf.slice(0, 12);
  const ct = buf.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, epoch, ct);
  return dec.decode(pt);
}

// ── Direct-message key derivation ────────────────────────────────────────────

/**
 * Derive the AES-GCM-256 key used to encrypt DM messages between me and one
 * other user. No key wrapping needed: ECDH(myPriv, theirPub) gives us a
 * shared secret that both parties can compute symmetrically (myPriv+theirPub
 * == theirPriv+myPub by the Diffie-Hellman property).
 *
 * The shared CryptoKey is deterministic for any given user pair, so messages
 * stay decryptable across sessions as long as both parties keep their
 * keypairs (which they do — the priv key is durably stored in TideCloak
 * self-encrypt).
 *
 * Key chain: TideCloak self-encrypt → my priv ECDH → ECDH(myPriv, theirPub) →
 * AES-GCM key → message ciphertext.
 */
export async function deriveDmKey(
  myPriv: CryptoKey,
  theirPubB64: string,
): Promise<CryptoKey> {
  const theirPub = await importPublicKey(theirPubB64);
  return crypto.subtle.deriveKey(
    { name: "ECDH", public: theirPub },
    myPriv,
    AES_PARAMS,
    false, // non-extractable; we never need the raw bytes for DM
    ["encrypt", "decrypt"],
  );
}

/**
 * Derive an AES-GCM key from the channel id alone — used for group DMs as
 * a transport cipher. NOT true E2EE: anyone who knows the channel id (the
 * server included) can derive the same key. Real per-member-wrapped epoch
 * keys are tracked as a follow-up; the group DM UI surfaces this caveat.
 */
export async function deriveGroupDmKey(channelId: string): Promise<CryptoKey> {
  const buf = new TextEncoder().encode(`zl:groupdm:v1:${channelId}`);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

// ── Voice signaling MAC ──────────────────────────────────────────────────────

/** Derive an HMAC-SHA256 subkey from the server epoch key for authenticating
 *  WebRTC SDP exchanges. The server never has the epoch key, so it cannot
 *  forge HMACs — this prevents the server from silently MITMing voice. */
async function hmacKeyFromEpoch(epoch: CryptoKey): Promise<CryptoKey> {
  const raw = await crypto.subtle.exportKey("raw", epoch);
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signSdp(
  epoch: CryptoKey,
  sdp: string,
): Promise<string> {
  const k = await hmacKeyFromEpoch(epoch);
  const sig = await crypto.subtle.sign(
    "HMAC",
    k,
    enc.encode(sdp) as unknown as BufferSource,
  );
  return bytesToB64(sig);
}

export async function verifySdp(
  epoch: CryptoKey,
  sdp: string,
  sigB64: string,
): Promise<boolean> {
  try {
    const k = await hmacKeyFromEpoch(epoch);
    return await crypto.subtle.verify(
      "HMAC",
      k,
      b64ToBytes(sigB64) as unknown as BufferSource,
      enc.encode(sdp) as unknown as BufferSource,
    );
  } catch {
    return false;
  }
}
