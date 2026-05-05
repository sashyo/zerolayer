"use client";

/**
 * CreateGroupDmModal — pick friends, optionally name the group, create.
 *
 * Mounted by ChannelSidebar's DM list when the user clicks the "+ Group DM"
 * button. POSTs `/api/dm` with `targetUserIds: string[]` and navigates to
 * the new channel on success.
 */
import { useEffect, useState } from "react";
import { Loader2, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTideCloak } from "@tidecloak/nextjs";
import { Avatar } from "@/components/Avatar";

interface FriendUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  status: string;
}

interface CreateGroupDmModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (channelId: string) => void;
}

export function CreateGroupDmModal({
  open,
  onClose,
  onCreated,
}: CreateGroupDmModalProps) {
  const { token } = useTideCloak();
  const router = useRouter();
  const [friends, setFriends] = useState<FriendUser[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !token) return;
    let cancelled = false;
    setLoading(true);
    fetch("/api/friends", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const accepted: FriendUser[] = (d.accepted ?? []).map((f: any) => f.user);
        setFriends(accepted);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, token]);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setName("");
    setFilter("");
    setError(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 9) next.add(id); // cap at 9 (10 total with caller)
      return next;
    });
  };

  const handleCreate = async () => {
    if (!token || selected.size < 2) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/dm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          targetUserIds: Array.from(selected),
          name: name.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Create failed (${res.status})`);
      }
      const { channelId } = await res.json();
      onCreated?.(channelId);
      onClose();
      router.push(`/channels/me/${channelId}`);
    } catch (e: any) {
      setError(e.message || "Create failed");
    } finally {
      setBusy(false);
    }
  };

  const filtered = friends.filter((f) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return (
      f.username.toLowerCase().includes(q) ||
      f.displayName.toLowerCase().includes(q)
    );
  });

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[28rem] max-w-[90vw] overflow-hidden rounded-lg bg-surface-200 shadow-2xl ring-1 ring-black/40"
      >
        <div className="flex items-center justify-between border-b border-surface-100/40 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Users className="h-4 w-4" />
            New Group DM
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted hover:bg-surface-100 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Optional group name"
            maxLength={60}
            className="mb-3 w-full rounded-md bg-surface-100 px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand"
          />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search friends"
            className="mb-2 w-full rounded-md bg-surface-100 px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand"
          />

          <div className="mb-2 max-h-64 overflow-y-auto rounded-md bg-surface-100/40">
            {loading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted" />
              </div>
            ) : friends.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-muted">
                Add some friends first.
              </p>
            ) : filtered.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-muted">
                No matches.
              </p>
            ) : (
              filtered.map((f) => {
                const checked = selected.has(f.id);
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => toggle(f.id)}
                    className={
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-100/70 " +
                      (checked ? "bg-brand/15" : "")
                    }
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      readOnly
                      className="accent-brand"
                    />
                    <Avatar user={f} size={28} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">
                        {f.displayName || f.username}
                      </p>
                      <p className="truncate text-xs text-muted">
                        @{f.username}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <p className="mb-2 text-[10px] text-muted">
            Pick 2–9 friends. Selected: {selected.size}/9
          </p>

          {error && (
            <div className="mb-2 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-surface-100/40 pt-3">
            <button
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-muted hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={busy || selected.size < 2}
              className="flex items-center gap-2 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-60"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Users className="h-4 w-4" />
              )}
              Create Group
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
