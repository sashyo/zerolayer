"use client";

import { useState } from "react";
import { useTideCloak } from "@tidecloak/nextjs";
import { X, Loader2, AlertTriangle } from "lucide-react";

interface DeleteServerModalProps {
  serverId: string;
  serverName: string;
  open: boolean;
  onClose: () => void;
  onDeleted?: () => void;
}

export function DeleteServerModal({
  serverId,
  serverName,
  open,
  onClose,
  onDeleted,
}: DeleteServerModalProps) {
  const { token } = useTideCloak();
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;
  const matches = confirmation === serverName;

  const handleDelete = async () => {
    if (!matches || !token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/servers/${serverId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Server returned ${res.status}`);
      }
      onDeleted?.();
      onClose();
      // Hard navigate so AppShell drops the deleted server from its state.
      window.location.assign("/channels/me");
    } catch (err: any) {
      setError(err.message || "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  const handleClose = () => {
    if (busy) return;
    setConfirmation("");
    setError(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-surface-200 shadow-2xl">
        <div className="flex items-center justify-between p-6 pb-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-400" />
            <h2 className="text-xl font-bold text-white">Delete Server</h2>
          </div>
          <button onClick={handleClose} disabled={busy} className="rounded p-1 text-muted hover:text-white disabled:opacity-40">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 pt-2">
          <p className="text-sm text-muted">
            This will permanently delete <span className="font-semibold text-white">{serverName}</span>,
            its channels, messages, members, and encryption keys. This cannot be undone.
          </p>

          <label className="mt-4 mb-2 block text-xs font-semibold uppercase tracking-wide text-muted">
            Type the server name to confirm
          </label>
          <input
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && matches && !busy && handleDelete()}
            placeholder={serverName}
            disabled={busy}
            className="w-full rounded-lg bg-surface-100 px-3 py-2.5 text-sm text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-red-500/50"
            autoFocus
          />

          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

          <div className="mt-6 flex gap-3">
            <button
              onClick={handleClose}
              disabled={busy}
              className="flex-1 rounded-lg border border-surface-400 py-2.5 text-sm text-muted hover:border-brand/40 hover:text-white disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={!matches || busy}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-500 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-red-500/40"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete forever"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
