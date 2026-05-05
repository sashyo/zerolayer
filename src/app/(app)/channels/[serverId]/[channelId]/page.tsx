"use client";

import { use, useEffect, useState } from "react";
import { useTideCloak } from "@tidecloak/nextjs";
import { ChatArea } from "@/components/chat/ChatArea";
import { VoiceRoom } from "@/components/voice/VoiceRoom";
import { Loader2 } from "lucide-react";
import { getServersCache } from "@/lib/serversCache";
import type { SerializedChannel, SerializedMember } from "@/types";

interface ChannelPageProps {
  params: Promise<{ serverId: string; channelId: string }>;
}

function resolveFromCache(
  serverId: string,
  channelId: string,
): { channel: SerializedChannel | null; members: SerializedMember[] } {
  const cache = getServersCache();
  const srv = cache.find((s) => s.id === serverId);
  const ch =
    (srv?.channels.find((c) => c.id === channelId) as SerializedChannel | undefined) ??
    null;
  return { channel: ch, members: (srv?.members as SerializedMember[]) ?? [] };
}

export default function ChannelPage({ params }: ChannelPageProps) {
  const { serverId, channelId } = use(params);
  const { token } = useTideCloak();
  // Seed synchronously from the AppShell-populated cache so switching
  // channels within an already-loaded server is instant — no spinner flash.
  const seed = resolveFromCache(serverId, channelId);
  const [channel, setChannel] = useState<SerializedChannel | null>(seed.channel);
  const [members, setMembers] = useState<SerializedMember[]>(seed.members);
  const [loading, setLoading] = useState(!seed.channel);
  const [diag, setDiag] = useState<{
    serverFound: boolean;
    channelFound: boolean;
    knownServerIds: string[];
    knownChannelIds: string[];
  } | null>(null);

  // When the URL changes mid-session, re-seed from the cache up front. This
  // keeps the ChatArea in sync immediately on click rather than waiting for
  // the network round-trip below.
  useEffect(() => {
    const fresh = resolveFromCache(serverId, channelId);
    setChannel(fresh.channel);
    setMembers(fresh.members);
    setLoading(!fresh.channel);
  }, [serverId, channelId]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch("/api/servers", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(({ servers }) => {
        if (cancelled) return;
        const list = Array.isArray(servers) ? servers : [];
        const server = list.find((s: any) => s.id === serverId);
        const ch = server?.channels?.find((c: any) => c.id === channelId);
        setChannel(ch ?? null);
        setMembers(server?.members ?? []);
        setDiag({
          serverFound: !!server,
          channelFound: !!ch,
          knownServerIds: list.map((s: any) => s.id),
          knownChannelIds: server?.channels?.map((c: any) => c.id) ?? [],
        });
        if (ch && ch.type !== "VOICE") {
          fetch(`/api/channels/${channelId}/join`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => {});
        }
      })
      .catch(console.warn)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [serverId, channelId, token]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (!channel) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted">
        <p className="text-sm">Channel not found</p>
        {diag && (
          <details className="max-w-md text-left text-xs opacity-70">
            <summary className="cursor-pointer">Diagnostics</summary>
            <div className="mt-2 space-y-1 font-mono">
              <div>looking for serverId: {serverId}</div>
              <div>looking for channelId: {channelId}</div>
              <div>
                serverFound: {String(diag.serverFound)} · channelFound:{" "}
                {String(diag.channelFound)}
              </div>
              <div>your servers: {diag.knownServerIds.join(", ") || "(none)"}</div>
              <div>
                channels in this server:{" "}
                {diag.knownChannelIds.join(", ") || "(none / not your server)"}
              </div>
            </div>
          </details>
        )}
      </div>
    );
  }

  if (channel.type === "VOICE") {
    const memberLabels = new Map<string, { displayName: string; initials: string }>();
    for (const m of members) {
      const display = m.user.displayName || m.user.username;
      memberLabels.set(m.userId, {
        displayName: display,
        initials: display.slice(0, 2).toUpperCase(),
      });
    }
    return (
      <VoiceRoom
        key={channel.id}
        serverId={serverId}
        channelId={channel.id}
        channelName={channel.name}
        memberLabels={memberLabels}
      />
    );
  }

  return (
    <ChatArea
      key={channel.id}
      serverId={serverId}
      channelId={channel.id}
      channelName={channel.name}
      channelDescription={channel.description}
      channelType={channel.type}
      isPrivate={channel.isPrivate}
      members={members}
    />
  );
}
