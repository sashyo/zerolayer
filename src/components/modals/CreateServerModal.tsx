"use client";

/**
 * CreateServerModal — server creation with E2EE bootstrap.
 *
 *   1. POST /api/servers   → creates the row + per-server TideCloak roles
 *   2. Generate AES-GCM-256 epoch key in the browser
 *   3. Wrap the epoch for the owner's own public key (ECDH-ES)
 *   4. POST /api/servers/[id]/keys with bumpToCurrent=true
 *
 * After this, the owner can decrypt server messages by:
 *   - using their TideCloak self-decrypt to unlock their private key
 *   - unwrapping the stored epoch wrap with that private key
 */
import { useState } from "react";
import { useTideCloak } from "@tidecloak/nextjs";
import { X, Loader2 } from "lucide-react";
import {
  generateEpochKey,
  wrapEpochForRecipient,
} from "@/lib/crypto";
import { useKeys } from "@/components/providers/KeysProvider";
import type { SerializedServer } from "@/types";

interface CreateServerModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (server: SerializedServer) => void;
}

export function CreateServerModal({ open, onClose, onCreated }: CreateServerModalProps) {
  const { token } = useTideCloak();
  const { publicKeyB64, ready: keysReady } = useKeys();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleCreate = async () => {
    if (!name.trim() || !token) return;
    if (!keysReady || !publicKeyB64) {
      setError("Your keypair isn't bootstrapped yet — wait a moment and retry");
      return;
    }
    setLoading(true);
    setError(null);

    try {
      setStage("Creating server…");
      const res = await fetch("/api/servers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const { error: msg } = await res.json();
        throw new Error(msg || "Failed to create server");
      }
      const { server } = (await res.json()) as { server: SerializedServer };

      setStage("Generating epoch key…");
      const epoch = await generateEpochKey();

      setStage("Wrapping for yourself…");
      const wrap = await wrapEpochForRecipient(epoch, publicKeyB64);

      setStage("Storing wrapped key…");
      console.log("[CreateServer] storing wrap", {
        serverId: server.id,
        ownerId: server.ownerId,
        publicKeyB64: publicKeyB64?.slice(0, 24) + "…",
      });
      const keyRes = await fetch(`/api/servers/${server.id}/keys`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          userId: server.ownerId,
          version: 1,
          ephemeralPub: wrap.ephemeralPubB64,
          iv: wrap.ivB64,
          wrappedKey: wrap.wrappedKeyB64,
          bumpToCurrent: true,
        }),
      });
      if (!keyRes.ok) {
        const body = await keyRes.text().catch(() => "");
        throw new Error(`epoch wrap POST ${keyRes.status}: ${body}`);
      }
      console.log("[CreateServer] wrap stored OK");

      onCreated(server);
      setName("");
      setDescription("");
    } catch (err: any) {
      console.error("[CreateServer] failed", err);
      setError(err.message || "Unknown error");
    } finally {
      setLoading(false);
      setStage("");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-surface-200 shadow-2xl">
        <div className="flex items-center justify-between p-6 pb-0">
          <div>
            <h2 className="text-xl font-bold text-white">Create Your Server</h2>
            <p className="mt-1 text-sm text-muted">
              Give your server a personality with a name. You can always change it later.
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6">
          <div className="mb-4">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted">
              Server Name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Awesome Server"
              className="w-full rounded-lg bg-surface-100 px-3 py-2.5 text-sm text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand"
              disabled={loading}
            />
          </div>

          <div className="mb-6">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted">
              Description{" "}
              <span className="font-normal normal-case text-muted/60">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this server about?"
              rows={3}
              className="w-full resize-none rounded-lg bg-surface-100 px-3 py-2.5 text-sm text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand"
              disabled={loading}
            />
          </div>

          {stage && (
            <p className="mb-2 text-xs text-muted">{stage}</p>
          )}
          {error && (
            <p className="mb-4 text-sm text-red-400">{error}</p>
          )}

          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={loading}
              className="flex-1 rounded-lg border border-surface-400 py-2.5 text-sm text-muted hover:border-brand/40 hover:text-white"
            >
              Back
            </button>
            <button
              onClick={handleCreate}
              disabled={!name.trim() || loading || !keysReady}
              className="flex-1 rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-brand/40"
            >
              {loading ? (
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              ) : (
                "Create Server"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
