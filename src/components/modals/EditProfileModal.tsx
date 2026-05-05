"use client";

/**
 * EditProfileModal — lets the user update displayName, bio, pronouns,
 * accent color, and avatar. Mounted once at AppShell; opens on
 * `zl:edit-profile`. PATCH goes through `/api/users/me`. After save we
 * dispatch `zl:profile-saved` so other panels (UserPanel, member list) can
 * re-fetch and reflect changes without a page reload.
 */
import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, Save, Trash2, X } from "lucide-react";
import { useTideCloak } from "@tidecloak/nextjs";
import { showToast } from "@/components/Toast";
import { Avatar } from "@/components/Avatar";

interface MyProfile {
  displayName: string;
  bio: string;
  pronouns: string;
  accentColor: string;
  avatarUrl: string | null;
  username: string;
}

const DEFAULT_ACCENT = "#5865F2";
// Cap the data URL we accept after canvas resize. 96KB is a reasonable upper
// bound for a 256x256 JPEG and keeps the User row from bloating the DB.
const MAX_AVATAR_BYTES = 96 * 1024;

export function EditProfileModal() {
  const { token } = useTideCloak();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<MyProfile>({
    displayName: "",
    bio: "",
    pronouns: "",
    accentColor: DEFAULT_ACCENT,
    avatarUrl: null,
    username: "",
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const [avatarErr, setAvatarErr] = useState<string | null>(null);

  const handleAvatarPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setAvatarErr(null);
    try {
      const dataUrl = await resizeImageToDataUrl(file, 256, 0.85);
      // Approx byte size of a base64 string: length * 3/4. We round up to be
      // safe.
      const approxBytes = Math.ceil((dataUrl.length * 3) / 4);
      if (approxBytes > MAX_AVATAR_BYTES) {
        throw new Error("Image too large after compression — try a smaller crop.");
      }
      setForm((f) => ({ ...f, avatarUrl: dataUrl }));
    } catch (err: any) {
      setAvatarErr(err.message || "Couldn't load that image");
    }
  };

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("zl:edit-profile", onOpen);
    return () => window.removeEventListener("zl:edit-profile", onOpen);
  }, []);

  useEffect(() => {
    if (!open || !token) return;
    let cancelled = false;
    setLoading(true);
    fetch("/api/users/me", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setForm({
          displayName: d.displayName ?? "",
          bio: d.bio ?? "",
          pronouns: d.pronouns ?? "",
          accentColor: d.accentColor ?? DEFAULT_ACCENT,
          avatarUrl: d.avatarUrl ?? null,
          username: d.username ?? "",
        });
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  const handleSave = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/users/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          displayName: form.displayName.trim() || undefined,
          bio: form.bio.trim() || null,
          pronouns: form.pronouns.trim() || null,
          accentColor: form.accentColor,
          avatarUrl: form.avatarUrl,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Save failed (${res.status})`);
      }
      showToast("Profile saved", "success");
      // Notify any UI showing the user's profile (UserPanel, member list,
      // chat avatars) so they re-fetch and reflect the edits live.
      window.dispatchEvent(new CustomEvent("zl:profile-saved"));
      setOpen(false);
    } catch (e: any) {
      setError(e.message || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60"
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[30rem] max-w-[90vw] overflow-hidden rounded-lg bg-surface-200 shadow-2xl ring-1 ring-black/40"
      >
        <div className="flex items-center justify-between border-b border-surface-100/40 px-4 py-3">
          <h3 className="text-sm font-semibold text-white">Edit Profile</h3>
          <button
            onClick={() => setOpen(false)}
            className="rounded p-1 text-muted hover:bg-surface-100 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted" />
            </div>
          ) : (
            <>
              {/* Banner + avatar preview */}
              <div className="relative mb-10 h-16 rounded-md" style={{ background: form.accentColor }}>
                <div className="absolute -bottom-8 left-3">
                  <div className="rounded-full border-4 border-surface-200">
                    <Avatar
                      user={{
                        displayName: form.displayName || "?",
                        username: form.username,
                        avatarUrl: form.avatarUrl,
                        accentColor: form.accentColor,
                      }}
                      size={64}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="absolute bottom-0 right-0 flex h-6 w-6 items-center justify-center rounded-full bg-surface-100 text-white shadow ring-1 ring-black/40 hover:bg-surface-100/80"
                    title="Change avatar"
                  >
                    <Camera className="h-3 w-3" />
                  </button>
                  {form.avatarUrl && (
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, avatarUrl: null }))}
                      className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500/20 text-red-300 ring-1 ring-black/40 hover:bg-red-500/30"
                      title="Remove avatar"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarPick}
                />
              </div>
              {avatarErr && (
                <div className="mb-2 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400">
                  {avatarErr}
                </div>
              )}

              <Field label="Display Name">
                <input
                  value={form.displayName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, displayName: e.target.value }))
                  }
                  maxLength={60}
                  className="w-full rounded-md bg-surface-100 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand"
                />
              </Field>

              <Field label="Pronouns">
                <input
                  value={form.pronouns}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, pronouns: e.target.value }))
                  }
                  maxLength={32}
                  placeholder="e.g. they/them"
                  className="w-full rounded-md bg-surface-100 px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand"
                />
              </Field>

              <Field label="About Me">
                <textarea
                  value={form.bio}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, bio: e.target.value }))
                  }
                  maxLength={500}
                  rows={4}
                  placeholder="Tell people a bit about yourself…"
                  className="w-full resize-none rounded-md bg-surface-100 px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand"
                />
                <p className="mt-1 text-right text-[10px] text-muted">
                  {form.bio.length}/500
                </p>
              </Field>

              <Field label="Banner Accent">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={form.accentColor}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, accentColor: e.target.value }))
                    }
                    className="h-8 w-12 cursor-pointer rounded bg-transparent"
                  />
                  <input
                    value={form.accentColor}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, accentColor: e.target.value }))
                    }
                    pattern="#[0-9a-fA-F]{6}"
                    className="flex-1 rounded-md bg-surface-100 px-3 py-2 font-mono text-xs text-white focus:outline-none focus:ring-2 focus:ring-brand"
                  />
                </div>
              </Field>

              {error && (
                <div className="mt-2 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400">
                  {error}
                </div>
              )}

              <div className="mt-4 flex justify-end gap-2 border-t border-surface-100/40 pt-3">
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-1.5 text-sm text-muted hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={busy}
                  className="flex items-center gap-2 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-60"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Save Changes
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Read a File, draw it onto a square canvas at `targetSize`, and return a
 * JPEG data URL. We don't ship binary to the server — `avatarUrl` is just a
 * string column. The canvas crops to a center square so non-square inputs
 * still look good as a circle.
 */
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
