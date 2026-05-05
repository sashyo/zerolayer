"use client";

/**
 * ServerSettingsModal — owner can rename the server (PATCH); members can
 * leave (POST /leave). Keeps things minimal on purpose; deletion lives in
 * the existing DeleteServerModal so the destructive action stays loud.
 */
import { useEffect, useRef, useState } from "react";
import { Bell, BellOff, Camera, X, Loader2, LogOut, Save, Trash2 } from "lucide-react";
import { useTideCloak } from "@tidecloak/nextjs";
import { useRouter } from "next/navigation";
import { toggleChannelMute, isChannelMuted } from "@/lib/channelMutes";
import { useChannelMutes } from "@/hooks/useChannelMutes";

interface ServerSettingsModalProps {
  open: boolean;
  serverId: string;
  serverName: string;
  serverIconUrl?: string | null;
  /** All channel ids in this server — used by the "Mute Server" toggle to
   *  apply the mute across every channel at once. */
  channelIds?: string[];
  isOwner: boolean;
  onClose: () => void;
  onUpdated?: (next: { id: string; name: string; iconUrl: string | null }) => void;
}

const MAX_ICON_BYTES = 96 * 1024;

async function resizeImageToDataUrl(
  file: File,
  targetSize: number,
  quality: number,
): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Couldn't decode that image"));
      el.src = url;
    });
    const min = Math.min(img.width, img.height);
    const sx = (img.width - min) / 2;
    const sy = (img.height - min) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = targetSize;
    canvas.height = targetSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported");
    ctx.drawImage(img, sx, sy, min, min, 0, 0, targetSize, targetSize);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ServerSettingsModal({
  open,
  serverId,
  serverName,
  serverIconUrl,
  channelIds = [],
  isOwner,
  onClose,
  onUpdated,
}: ServerSettingsModalProps) {
  const { token } = useTideCloak();
  const router = useRouter();
  const [name, setName] = useState(serverName);
  const [iconUrl, setIconUrl] = useState<string | null>(serverIconUrl ?? null);
  const [iconErr, setIconErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "leave" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Server mute = every channel in this server is muted. We treat "all
  // channels muted" as the toggle state. Reactive via useChannelMutes so
  // the button label flips live as mutes change.
  const muted = useChannelMutes();
  const allMuted =
    channelIds.length > 0 && channelIds.every((id) => muted.has(id));
  const toggleServerMute = () => {
    if (channelIds.length === 0) return;
    if (allMuted) {
      // Unmute every currently-muted channel.
      for (const id of channelIds) {
        if (isChannelMuted(id)) toggleChannelMute(id);
      }
    } else {
      // Mute everything that isn't already muted.
      for (const id of channelIds) {
        if (!isChannelMuted(id)) toggleChannelMute(id);
      }
    }
  };

  useEffect(() => {
    if (open) {
      setName(serverName);
      setIconUrl(serverIconUrl ?? null);
      setIconErr(null);
      setError(null);
    }
  }, [open, serverName, serverIconUrl]);

  const handleIconPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setIconErr(null);
    try {
      const dataUrl = await resizeImageToDataUrl(file, 256, 0.85);
      const approxBytes = Math.ceil((dataUrl.length * 3) / 4);
      if (approxBytes > MAX_ICON_BYTES) {
        throw new Error("Image too large after compression — try a smaller crop.");
      }
      setIconUrl(dataUrl);
    } catch (err: any) {
      setIconErr(err.message || "Couldn't load that image");
    }
  };

  if (!open) return null;

  const handleSave = async () => {
    if (!token) return;
    const trimmed = name.trim();
    const nameChanged = trimmed && trimmed !== serverName;
    const iconChanged = iconUrl !== (serverIconUrl ?? null);
    if (!nameChanged && !iconChanged) {
      onClose();
      return;
    }
    setBusy("save");
    setError(null);
    try {
      const res = await fetch(`/api/servers/${serverId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...(nameChanged ? { name: trimmed } : {}),
          ...(iconChanged ? { iconUrl } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Save failed (${res.status})`);
      }
      const { server } = await res.json();
      onUpdated?.({
        id: server.id,
        name: server.name,
        iconUrl: server.iconUrl ?? null,
      });
      onClose();
    } catch (e: any) {
      setError(e.message || "Save failed");
    } finally {
      setBusy(null);
    }
  };

  const handleLeave = async () => {
    if (!token) return;
    if (!confirm(`Leave ${serverName}? You'll lose access to its channels.`)) return;
    setBusy("leave");
    setError(null);
    try {
      const res = await fetch(`/api/servers/${serverId}/leave`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Leave failed (${res.status})`);
      }
      onClose();
      router.push("/channels/me");
      router.refresh();
    } catch (e: any) {
      setError(e.message || "Leave failed");
    } finally {
      setBusy(null);
    }
  };

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
          <h3 className="text-sm font-semibold text-white">Server Settings</h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted hover:bg-surface-100 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          {isOwner && (
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
                Icon
              </label>
              <div className="flex items-center gap-3">
                <div className="relative">
                  {iconUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={iconUrl}
                      alt={name}
                      className="h-16 w-16 rounded-2xl object-cover"
                    />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand text-lg font-bold">
                      {name
                        .split(/\s+/)
                        .slice(0, 2)
                        .map((w) => w[0]?.toUpperCase() ?? "")
                        .join("")}
                    </div>
                  )}
                  {iconUrl && (
                    <button
                      type="button"
                      onClick={() => setIconUrl(null)}
                      className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500/20 text-red-300 ring-1 ring-black/40 hover:bg-red-500/30"
                      title="Remove icon"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-2 rounded-md bg-surface-100 px-3 py-1.5 text-sm text-white hover:bg-surface-100/70"
                  >
                    <Camera className="h-4 w-4" />
                    Upload icon
                  </button>
                  <p className="text-[10px] text-muted">
                    JPEG/PNG, square recommended.
                  </p>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleIconPick}
                />
              </div>
              {iconErr && (
                <div className="mt-2 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400">
                  {iconErr}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
              Name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isOwner || busy !== null}
              maxLength={60}
              className="w-full rounded-md bg-surface-100 px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60"
            />
            {!isOwner && (
              <p className="mt-1 text-xs text-muted">
                Only the server owner can rename this server.
              </p>
            )}
          </div>

          {error && (
            <div className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}

          {channelIds.length > 0 && (
            <button
              type="button"
              onClick={toggleServerMute}
              className="flex w-full items-center justify-between rounded-md bg-surface-100/40 px-3 py-2 text-sm hover:bg-surface-100/60"
            >
              <span className="flex items-center gap-2 text-white">
                {allMuted ? (
                  <BellOff className="h-4 w-4 text-yellow-300" />
                ) : (
                  <Bell className="h-4 w-4 text-muted" />
                )}
                {allMuted ? "Server muted" : "Mute server"}
              </span>
              <span className="text-xs text-muted">
                {allMuted
                  ? "Tap to unmute all channels"
                  : "Mutes every channel in this server"}
              </span>
            </button>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-surface-100/40 pt-3">
            {isOwner && (
              <button
                onClick={handleSave}
                disabled={busy !== null}
                className="flex items-center gap-2 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-60"
              >
                {busy === "save" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save Changes
              </button>
            )}
            {!isOwner && (
              <button
                onClick={handleLeave}
                disabled={busy !== null}
                className="ml-auto flex items-center gap-2 rounded-md bg-red-500/15 px-3 py-1.5 text-sm font-medium text-red-300 hover:bg-red-500/25 disabled:opacity-60"
              >
                {busy === "leave" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <LogOut className="h-4 w-4" />
                )}
                Leave Server
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
