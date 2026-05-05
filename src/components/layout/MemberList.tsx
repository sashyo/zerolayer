"use client";

import { useMemo, useState } from "react";
import { UserPlus, Headphones } from "lucide-react";
import { cn } from "@/lib/utils";
import { AddMemberModal } from "@/components/modals/AddMemberModal";
import { usePresence, type PresenceStatus } from "@/components/providers/PresenceProvider";
import { openProfile } from "@/components/chat/ProfilePopover";
import { useVoiceRoster } from "@/hooks/useVoiceRoster";
import { Avatar } from "@/components/Avatar";
import type { SerializedMember, SerializedServer } from "@/types";

const STATUS_COLOR: Record<string, string> = {
  ONLINE: "bg-green-500",
  IDLE: "bg-yellow-500",
  DND: "bg-red-500",
  OFFLINE: "bg-surface-400",
};

interface MemberListProps {
  members: SerializedMember[];
  serverId?: string;
  serverName?: string;
  isOwner?: boolean;
  channels?: SerializedServer["channels"];
  onMemberAdded?: () => void;
}

export function MemberList({
  members,
  serverId,
  serverName,
  isOwner,
  channels,
  onMemberAdded,
}: MemberListProps) {
  const [showAdd, setShowAdd] = useState(false);
  const { statuses } = usePresence();
  const liveStatus = (userId: string): PresenceStatus =>
    statuses.get(userId) ?? "OFFLINE";
  const online = members.filter((m) => liveStatus(m.userId) !== "OFFLINE");
  const offline = members.filter((m) => liveStatus(m.userId) === "OFFLINE");

  // Build a userId → "in voice channel <name>" lookup, scoped to channels
  // belonging to the active server so we don't show "in voice" for channels
  // outside this server's roster.
  const roster = useVoiceRoster();
  const voiceFor = useMemo(() => {
    const map = new Map<string, { channelId: string; channelName: string }>();
    if (!channels) return map;
    for (const ch of channels) {
      if (ch.type !== "VOICE") continue;
      const occupants = roster.get(ch.id) ?? [];
      for (const o of occupants) {
        if (!map.has(o.userId)) {
          map.set(o.userId, { channelId: ch.id, channelName: ch.name });
        }
      }
    }
    return map;
  }, [roster, channels]);

  return (
    <aside className="hidden w-60 flex-col overflow-y-auto bg-surface-200 px-3 py-4 xl:flex">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          {serverName ? "Members" : ""}
        </span>
        <span className="text-[10px] text-muted">
          {online.length}/{members.length} online
        </span>
      </div>
      {isOwner && serverId && (
        <button
          onClick={() => setShowAdd(true)}
          title="Add a member"
          className="mb-3 flex items-center justify-center gap-1.5 rounded-lg bg-brand/10 px-3 py-2 text-xs font-semibold text-brand hover:bg-brand/20"
        >
          <UserPlus className="h-3.5 w-3.5" />
          Add Member
        </button>
      )}
      <MemberGroup label={`Online — ${online.length}`} members={online} voiceFor={voiceFor} />
      {offline.length > 0 && (
        <MemberGroup label={`Offline — ${offline.length}`} members={offline} voiceFor={voiceFor} />
      )}

      {serverId && serverName && (
        <AddMemberModal
          open={showAdd}
          serverId={serverId}
          serverName={serverName}
          onClose={() => setShowAdd(false)}
          onAdded={() => {
            setShowAdd(false);
            onMemberAdded?.();
          }}
        />
      )}
    </aside>
  );
}

function MemberGroup({
  label,
  members,
  voiceFor,
}: {
  label: string;
  members: SerializedMember[];
  voiceFor: Map<string, { channelId: string; channelName: string }>;
}) {
  return (
    <div className="mb-4">
      <p className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
      </p>
      {members.map((m) => (
        <MemberRow
          key={m.userId}
          member={m}
          voice={voiceFor.get(m.userId)}
        />
      ))}
    </div>
  );
}

function MemberRow({
  member,
  voice,
}: {
  member: SerializedMember;
  voice?: { channelId: string; channelName: string };
}) {
  const { user, role } = member;
  const { statuses } = usePresence();
  const status = statuses.get(member.userId) ?? "OFFLINE";

  return (
    <button
      type="button"
      onClick={() =>
        openProfile({
          id: member.userId,
          username: user.username,
          displayName: user.displayName,
        })
      }
      className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-left hover:bg-surface-400/50"
    >
      <div className="relative shrink-0">
        <Avatar
          // Role color trumps accent in member list — that's the Discord
          // pattern: your "color in this server" comes from your role.
          user={role?.color ? { ...user, accentColor: role.color } : user}
          size={32}
          fallbackBg="bg-brand"
        />
        <span
          className={cn(
            "absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-surface-200",
            STATUS_COLOR[status] ?? STATUS_COLOR.OFFLINE,
          )}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-muted-foreground">
          {user.displayName || user.username}
        </p>
        {voice ? (
          <p className="flex items-center gap-1 truncate text-xs text-green-300">
            <Headphones className="h-3 w-3 shrink-0" />
            <span className="truncate">{voice.channelName}</span>
          </p>
        ) : (
          role &&
          !role.name.startsWith("@") && (
            <p className="truncate text-xs" style={{ color: role.color }}>
              {role.name}
            </p>
          )
        )}
      </div>
    </button>
  );
}
