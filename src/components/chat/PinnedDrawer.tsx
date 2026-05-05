"use client";

/**
 * PinnedDrawer — overlay listing the channel's pinned messages.
 *
 * Fetches `/api/channels/[id]/pinned`, decrypts each entry through the same
 * `getKey` resolver that powers ChatArea's main message list, and lets the
 * server owner unpin from the drawer. Mounted as an absolute overlay above
 * the chat — clicking outside or the close button dismisses it.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pin, X, Loader2 } from "lucide-react";
import { useTideCloak } from "@tidecloak/nextjs";
import { decryptMessage } from "@/lib/crypto";
import type { SerializedMessage } from "@/types";

interface PinnedDrawerProps {
  channelId: string;
  isServerOwner: boolean;
  getKey: (version: number) => Promise<CryptoKey | null>;
  onClose: () => void;
  onUnpinned?: (msg: SerializedMessage) => void;
}

export function PinnedDrawer({
  channelId,
  isServerOwner,
  getKey,
  onClose,
  onUnpinned,
}: PinnedDrawerProps) {
  const { token } = useTideCloak();
  const [pinned, setPinned] = useState<SerializedMessage[]>([]);
  const [plaintexts, setPlaintexts] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

  const decryptAll = useCallback(
    async (list: SerializedMessage[]) => {
      const next = new Map<string, string>();
      await Promise.all(
        list.map(async (m) => {
          try {
            const k = await getKey(m.keyVersion);
            if (!k) return;
            const text = await decryptMessage(k, m.content);
            next.set(m.id, text);
          } catch {}
        }),
      );
      setPlaintexts(next);
    },
    [getKey],
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/channels/${channelId}/pinned`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then(async ({ messages }) => {
        if (cancelled) return;
        setPinned(messages ?? []);
        await decryptAll(messages ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [channelId, token, decryptAll]);

  const handleUnpin = async (msg: SerializedMessage) => {
    if (!token) return;
    const res = await fetch(
      `/api/channels/${channelId}/messages/${msg.id}/pin`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return;
    const { message } = await res.json();
    setPinned((prev) => prev.filter((p) => p.id !== msg.id));
    onUnpinned?.(message);
  };

  const sorted = useMemo(
    () =>
      [...pinned].sort(
        (a, b) =>
          new Date(b.pinnedAt ?? b.createdAt).getTime() -
          new Date(a.pinnedAt ?? a.createdAt).getTime(),
      ),
    [pinned],
  );

  return (
    <>
      <div
        className="fixed inset-0 z-30"
        onClick={onClose}
        aria-hidden
      />
      <div className="absolute right-2 top-12 z-40 flex max-h-[60vh] w-80 flex-col overflow-hidden rounded-lg bg-surface-100 shadow-2xl ring-1 ring-black/40">
        <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-white">
            <Pin className="h-4 w-4 text-yellow-400" />
            Pinned messages
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted hover:bg-surface-200/60 hover:text-white"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-muted" />
            </div>
          ) : sorted.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted">
              No pinned messages yet. Server owners can pin a message from its
              hover toolbar.
            </p>
          ) : (
            sorted.map((m) => {
              const plain = plaintexts.get(m.id);
              const jump = () => {
                const el = document.getElementById(`msg-${m.id}`);
                if (!el) return;
                el.scrollIntoView({ behavior: "smooth", block: "center" });
                el.classList.add("ring-2", "ring-brand", "rounded");
                setTimeout(
                  () => el.classList.remove("ring-2", "ring-brand", "rounded"),
                  1400,
                );
                onClose();
              };
              return (
                <div
                  key={m.id}
                  className="group border-b border-white/5 px-3 py-2 text-sm hover:bg-surface-200/40"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold text-white">
                      {m.author.displayName || m.author.username}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={jump}
                        className="text-[11px] text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-brand"
                      >
                        Jump
                      </button>
                      {isServerOwner && (
                        <button
                          onClick={() => handleUnpin(m)}
                          className="text-[11px] text-muted hover:text-yellow-400"
                        >
                          Unpin
                        </button>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={jump}
                    className="mt-0.5 block w-full text-left whitespace-pre-wrap text-[#dcddde] hover:text-white"
                  >
                    {plain ?? <span className="italic text-muted">…</span>}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
