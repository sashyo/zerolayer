"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTideCloak } from "@tidecloak/nextjs";
import { X, Loader2, ArrowRight } from "lucide-react";

interface JoinServerModalProps {
  open: boolean;
  onClose: () => void;
  onJoined?: (serverId: string) => void;
}

const INVITE_REGEX = /(?:invite\/)?([A-Za-z0-9_-]{4,64})\/?$/;

export function JoinServerModal({ open, onClose, onJoined }: JoinServerModalProps) {
  const { token } = useTideCloak();
  const router = useRouter();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const extractCode = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const match = trimmed.match(INVITE_REGEX);
    return match?.[1] ?? null;
  };

  const handleJoin = async () => {
    const code = extractCode(input);
    if (!code || !token) {
      setError("Enter a valid invite link or code");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/servers/join", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ inviteCode: code }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Server returned ${res.status}`);
      }
      const { serverId } = await res.json();
      onJoined?.(serverId);
      onClose();
      setInput("");
      // Hard navigate so AppShell re-fetches its server list and the new
      // server icon appears in the rail.
      window.location.assign(`/channels/${serverId}`);
    } catch (err: any) {
      setError(err.message || "Failed to join server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-surface-200 shadow-2xl">
        <div className="flex items-center justify-between p-6 pb-0">
          <div>
            <h2 className="text-xl font-bold text-white">Join a Server</h2>
            <p className="mt-1 text-sm text-muted">
              Paste an invite link or code below to join.
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted">
            Invite Link or Code
          </label>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !loading && handleJoin()}
            placeholder="https://… /invite/abc123  or  abc123"
            className="w-full rounded-lg bg-surface-100 px-3 py-2.5 text-sm text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand"
            disabled={loading}
            autoFocus
          />

          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

          <div className="mt-6 flex gap-3">
            <button
              onClick={onClose}
              disabled={loading}
              className="flex-1 rounded-lg border border-surface-400 py-2.5 text-sm text-muted hover:border-brand/40 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={handleJoin}
              disabled={!input.trim() || loading}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand py-2.5 text-sm font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-brand/40"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  Join Server <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
