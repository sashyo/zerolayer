"use client";

/**
 * ProfilePopover — Discord-style member profile card.
 *
 * Mounted once at AppShell level. Any caller can dispatch
 * `window.dispatchEvent(new CustomEvent("zl:profile", {detail:{user}}))`
 * to open it. Detail must include {id, username, displayName} so we can
 * render even for users who aren't in any currently-loaded member list
 * (e.g. a DM partner where activeServer is null).
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, X } from "lucide-react";
import { useTideCloak } from "@tidecloak/nextjs";
import { usePresence } from "@/components/providers/PresenceProvider";
import { Avatar } from "@/components/Avatar";

interface ProfileTarget {
  id: string;
  username: string;
  displayName: string;
}

const STATUS_LABEL: Record<string, string> = {
  ONLINE: "Online",
  IDLE: "Idle",
  DND: "Do Not Disturb",
  OFFLINE: "Offline",
};

const STATUS_COLOR: Record<string, string> = {
  ONLINE: "bg-green-500",
  IDLE: "bg-yellow-500",
  DND: "bg-red-500",
  OFFLINE: "bg-surface-400",
};

export function ProfilePopover() {
  const router = useRouter();
  const { token, getValueFromToken } = useTideCloak();
  const { statuses, customStatuses } = usePresence();
  const mySub = (getValueFromToken("sub") as string) ?? "";

  const [target, setTarget] = useState<ProfileTarget | null>(null);
  const [profile, setProfile] = useState<{
    bio?: string | null;
    pronouns?: string | null;
    accentColor?: string | null;
    avatarUrl?: string | null;
    displayName?: string | null;
    createdAt?: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ user: ProfileTarget }>).detail;
      if (detail?.user?.id) {
        setTarget(detail.user);
        setProfile(null);
      }
    };
    window.addEventListener("zl:profile", onOpen);
    return () => window.removeEventListener("zl:profile", onOpen);
  }, []);

  // Lazily fetch the rich profile (bio, accent, member-since) when the popover
  // opens. We render the basics from `target` so there's no flash.
  useEffect(() => {
    if (!target || !token) return;
    let cancelled = false;
    fetch(`/api/users/${target.id}/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setProfile({
          bio: d.bio ?? null,
          pronouns: d.pronouns ?? null,
          accentColor: d.accentColor ?? null,
          avatarUrl: d.avatarUrl ?? null,
          displayName: d.displayName ?? null,
          createdAt: d.createdAt ?? null,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [target, token]);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTarget(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [target]);

  if (!target) return null;

  const status = statuses.get(target.id) ?? "OFFLINE";
  const displayName = profile?.displayName || target.displayName || target.username || "Unknown";
  const username = target.username || target.id.slice(0, 8);
  const isMe = target.id === mySub;

  const handleDm = async () => {
    if (!token || isMe || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/dm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ targetUserId: target.id }),
      });
      if (!res.ok) return;
      const { channelId } = await res.json();
      setTarget(null);
      router.push(`/channels/me/${channelId}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[60]"
        onClick={() => setTarget(null)}
        aria-hidden
      />
      <div className="fixed left-1/2 top-1/2 z-[61] w-80 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg bg-surface-100 shadow-2xl ring-1 ring-black/40">
        <div
          className="h-16"
          style={{
            background:
              profile?.accentColor ??
              "linear-gradient(135deg, rgb(88 101 242 / 0.4), rgb(88 101 242 / 0.15))",
          }}
        />
        <div className="relative px-4 pb-4">
          <div className="absolute -top-9 left-4">
            <div className="rounded-full border-4 border-surface-100">
              <Avatar
                user={{
                  id: target.id,
                  username: target.username,
                  displayName,
                  avatarUrl: profile?.avatarUrl ?? null,
                  accentColor: profile?.accentColor ?? null,
                }}
                size={64}
              />
            </div>
            <span
              className={`absolute bottom-0 right-0 h-4 w-4 rounded-full border-2 border-surface-100 ${STATUS_COLOR[status]}`}
            />
          </div>
          <button
            onClick={() => setTarget(null)}
            className="absolute right-2 top-2 rounded p-1 text-muted hover:bg-surface-200/60 hover:text-white"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="pt-10">
            <div className="flex items-baseline gap-2">
              <div className="text-base font-semibold text-white">
                {displayName}
              </div>
              {profile?.pronouns && (
                <span className="text-xs text-muted">{profile.pronouns}</span>
              )}
            </div>
            <div className="text-xs text-muted">@{username}</div>
            <div className="mt-1 text-xs text-muted">
              {STATUS_LABEL[status] ?? "Offline"}
            </div>
            {customStatuses.get(target.id) && (
              <div className="mt-2 rounded bg-surface-200/60 px-2 py-1 text-xs italic text-white/80">
                {customStatuses.get(target.id)}
              </div>
            )}

            {profile?.bio && (
              <div className="mt-3 border-t border-white/5 pt-3">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  About me
                </p>
                <p className="whitespace-pre-wrap text-sm text-[#dcddde]">
                  {profile.bio}
                </p>
              </div>
            )}

            {profile?.createdAt && (
              <div className="mt-3 border-t border-white/5 pt-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Member since
                </p>
                <p className="text-xs text-[#dcddde]">
                  {new Date(profile.createdAt).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              </div>
            )}

            {!isMe && (
              <button
                onClick={handleDm}
                disabled={busy}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-brand py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-60"
              >
                <MessageSquare className="h-4 w-4" />
                Send Message
              </button>
            )}
            {isMe && (
              <button
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("zl:edit-profile"));
                  setTarget(null);
                }}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-surface-200/80 py-2 text-sm font-medium text-white hover:bg-surface-200"
              >
                Edit Profile
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/** Helper so callers don't have to remember the event shape. */
export function openProfile(user: ProfileTarget) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("zl:profile", { detail: { user } }));
}
