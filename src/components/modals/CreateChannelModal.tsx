"use client";

/**
 * CreateChannelModal — keypair-mode.
 *
 * Channels no longer carry per-channel encryption material; they inherit the
 * parent server's epoch key. So this modal is just a name + visibility input
 * and a single POST.
 */
import { useState } from "react";
import { useTideCloak } from "@tidecloak/nextjs";
import { X, Hash, Volume2, Lock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SerializedChannel } from "@/types";

interface CreateChannelModalProps {
  serverId: string;
  open: boolean;
  onClose: () => void;
  onCreated: (channel: SerializedChannel) => void;
}

export function CreateChannelModal({
  serverId,
  open,
  onClose,
  onCreated,
}: CreateChannelModalProps) {
  const { token } = useTideCloak();
  const [name, setName] = useState("");
  const [type, setType] = useState<"TEXT" | "VOICE">("TEXT");
  const [isPrivate, setIsPrivate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleCreate = async () => {
    if (!name.trim() || !token) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/servers/${serverId}/channels`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: name.trim(), type, isPrivate }),
      });
      if (!res.ok) {
        const { error: msg } = await res.json();
        throw new Error(msg || "Failed to create channel");
      }
      const { channel } = await res.json();
      onCreated(channel);
      setName("");
      setType("TEXT");
      setIsPrivate(false);
      onClose();
    } catch (err: any) {
      setError(err.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-surface-200 shadow-2xl">
        <div className="flex items-center justify-between p-6 pb-2">
          <h2 className="text-xl font-bold text-white">Create Channel</h2>
          <button onClick={onClose} className="rounded p-1 text-muted hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 pt-2">
          <div className="mb-4">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted">
              Channel Type
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setType("TEXT")}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm",
                  type === "TEXT"
                    ? "border-brand bg-brand/10 text-white"
                    : "border-surface-400 text-muted hover:text-white",
                )}
              >
                <Hash className="h-4 w-4" /> Text
              </button>
              <button
                type="button"
                onClick={() => setType("VOICE")}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm",
                  type === "VOICE"
                    ? "border-brand bg-brand/10 text-white"
                    : "border-surface-400 text-muted hover:text-white",
                )}
              >
                <Volume2 className="h-4 w-4" /> Voice
              </button>
            </div>
          </div>

          <div className="mb-4">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted">
              Channel Name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
              placeholder="general"
              disabled={loading}
              className="w-full rounded-lg bg-surface-100 px-3 py-2.5 text-sm text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>

          <label className="mb-4 flex items-center gap-2 text-sm text-white">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              disabled={loading}
              className="h-4 w-4 accent-brand"
            />
            <Lock className="h-3.5 w-3.5 text-muted" />
            <span>Private channel</span>
          </label>

          {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={loading}
              className="flex-1 rounded-lg border border-surface-400 py-2.5 text-sm text-muted hover:border-brand/40 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!name.trim() || loading}
              className="flex-1 rounded-lg bg-brand py-2.5 text-sm font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-brand/40"
            >
              {loading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
