"use client";

import { useEffect, useRef, useState } from "react";
import { useTideCloak } from "@tidecloak/nextjs";
import { Bell, Headphones, Mic, Settings, Users, Pencil, X } from "lucide-react";
import { SettingsModal } from "@/components/modals/SettingsModal";
import { usePresence } from "@/components/providers/PresenceProvider";
import { openProfile } from "@/components/chat/ProfilePopover";
import { Avatar } from "@/components/Avatar";

interface UserPanelProps {
  onToggleMembers: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  ONLINE: "Online",
  IDLE: "Idle",
  DND: "Do Not Disturb",
  OFFLINE: "Offline",
};

const STATUS_DOT: Record<string, string> = {
  ONLINE: "bg-status-online",
  IDLE: "bg-status-idle",
  DND: "bg-status-dnd",
  OFFLINE: "bg-status-offline",
};

export function UserPanel({ onToggleMembers }: UserPanelProps) {
  const { getValueFromToken, token } = useTideCloak();
  const mySub = (getValueFromToken("sub") as string) ?? "";
  const jwtDisplay = (getValueFromToken("name") as string) ?? "";
  const jwtUsername = (getValueFromToken("preferred_username") as string) ?? "";
  const { myStatus, myCustomStatus, setCustomStatus } = usePresence();
  // Canonical profile from the DB — overrides JWT claims so live edits
  // (display name, avatar, accent) show up without a re-login. We re-fetch
  // when the modal closes so changes propagate immediately.
  const [me, setMe] = useState<{
    displayName: string;
    username: string;
    avatarUrl: string | null;
    accentColor: string | null;
  } | null>(null);
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const refresh = () =>
      fetch("/api/users/me", { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          setMe({
            displayName: d.displayName ?? jwtDisplay,
            username: d.username ?? jwtUsername,
            avatarUrl: d.avatarUrl ?? null,
            accentColor: d.accentColor ?? null,
          });
        })
        .catch(() => {});
    refresh();
    const onChanged = () => refresh();
    window.addEventListener("zl:profile-saved", onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("zl:profile-saved", onChanged);
    };
  }, [token, jwtDisplay, jwtUsername]);
  const [showSettings, setShowSettings] = useState(false);
  const [editingStatus, setEditingStatus] = useState(false);
  const [draftStatus, setDraftStatus] = useState(myCustomStatus);
  const draftRef = useRef<HTMLInputElement>(null);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | "unsupported">(
    "default",
  );

  useEffect(() => {
    if (editingStatus) draftRef.current?.focus();
  }, [editingStatus]);

  const commitStatus = () => {
    setCustomStatus(draftStatus.trim());
    setEditingStatus(false);
  };
  const clearStatus = () => {
    setDraftStatus("");
    setCustomStatus("");
    setEditingStatus(false);
  };

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setNotifPerm("unsupported");
      return;
    }
    setNotifPerm(Notification.permission);
  }, []);

  const askNotifications = async () => {
    if (notifPerm === "unsupported") return;
    const result = await Notification.requestPermission();
    setNotifPerm(result);
  };

  const display = me?.displayName || jwtDisplay || jwtUsername || "You";

  return (
    <div className="flex h-14 items-center gap-2 border-t border-surface-100/20 bg-surface-100/50 px-2">
      {/* Avatar — click to open own profile popover */}
      <button
        type="button"
        onClick={() =>
          openProfile({
            id: mySub,
            username: me?.username || jwtUsername || display,
            displayName: display,
          })
        }
        className="relative shrink-0 transition-transform hover:scale-105"
        title="Your profile"
      >
        <Avatar
          user={{
            id: mySub,
            displayName: display,
            username: me?.username,
            avatarUrl: me?.avatarUrl ?? null,
            accentColor: me?.accentColor ?? null,
          }}
          size={32}
        />
        <span
          className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-surface-200 ${STATUS_DOT[myStatus] ?? "bg-status-online"}`}
        />
      </button>

      {/* Name + custom status */}
      <div className="flex-1 overflow-hidden">
        <p className="truncate text-sm font-medium text-white">{display}</p>
        {editingStatus ? (
          <input
            ref={draftRef}
            value={draftStatus}
            onChange={(e) => setDraftStatus(e.target.value)}
            onBlur={commitStatus}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitStatus();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setDraftStatus(myCustomStatus);
                setEditingStatus(false);
              }
            }}
            placeholder="Set a custom status…"
            maxLength={60}
            className="w-full truncate bg-transparent text-xs text-muted placeholder-muted/60 focus:outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraftStatus(myCustomStatus);
              setEditingStatus(true);
            }}
            className="group flex w-full items-center gap-1 truncate text-left text-xs text-muted hover:text-white"
            title={
              myCustomStatus
                ? "Edit custom status"
                : "Click to set a custom status"
            }
          >
            <span className="truncate">
              {myCustomStatus || STATUS_LABEL[myStatus] || "Online"}
            </span>
            <Pencil className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-60" />
            {myCustomStatus && (
              <span
                role="button"
                tabIndex={0}
                onClick={(ev) => {
                  ev.stopPropagation();
                  clearStatus();
                }}
                className="ml-auto rounded p-0.5 text-muted hover:bg-surface-400/40 hover:text-white"
                title="Clear status"
              >
                <X className="h-3 w-3" />
              </span>
            )}
          </button>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1">
        {notifPerm === "default" && (
          <IconBtn
            title="Enable browser notifications for @mentions"
            onClick={askNotifications}
          >
            <Bell className="h-4 w-4 text-yellow-300" />
          </IconBtn>
        )}
        <IconBtn title="Toggle member list" onClick={onToggleMembers}>
          <Users className="h-4 w-4" />
        </IconBtn>
        <IconBtn title="Mute">
          <Mic className="h-4 w-4" />
        </IconBtn>
        <IconBtn title="Deafen">
          <Headphones className="h-4 w-4" />
        </IconBtn>
        <IconBtn title="User Settings" onClick={() => setShowSettings(true)}>
          <Settings className="h-4 w-4" />
        </IconBtn>
      </div>
      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}

function IconBtn({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="rounded p-1 text-muted transition-colors hover:bg-surface-400/50 hover:text-white"
    >
      {children}
    </button>
  );
}
