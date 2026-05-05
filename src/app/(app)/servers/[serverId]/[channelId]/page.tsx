"use client";

import { use, useEffect, useState } from "react";
import { useTideCloak } from "@tidecloak/nextjs";
import { ChatArea } from "@/components/chat/ChatArea";
import { VoiceRoom } from "@/components/voice/VoiceRoom";
import { Loader2 } from "lucide-react";
import type { SerializedChannel } from "@/types";

interface ChannelPageProps {
  params: Promise<{ serverId: string; channelId: string }>;
}

export default function ChannelPage({ params }: ChannelPageProps) {
  const { serverId, channelId } = use(params);
  const { token, getValueFromToken } = useTideCloak();
  const [channel, setChannel] = useState<SerializedChannel | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);

  // Reset state synchronously on channel switch so we never render stale
  // chat for a beat while the new fetch is in flight.
  useEffect(() => {
    setChannel(null);
    setLoading(true);
  }, [channelId]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch("/api/servers", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(({ servers }) => {
        if (cancelled) return;
        const server = servers?.find((s: any) => s.id === serverId);
        const ch = server?.channels?.find((c: any) => c.id === channelId);
        setChannel(ch ?? null);
        setIsOwner(server?.ownerId === (getValueFromToken("sub") as string));

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
      <div className="flex flex-1 items-center justify-center text-muted">
        Channel not found
      </div>
    );
  }

  if (channel.type === "VOICE") {
    return (
      <VoiceRoom
        key={channel.id}
        serverId={serverId}
        channelId={channel.id}
        channelName={channel.name}
      />
    );
  }

  return (
    <ChatArea
      key={channel.id}
      serverId={serverId}
      channelId={channel.id}
      channelName={channel.name}
      channelType={channel.type}
      isPrivate={channel.isPrivate}
    />
  );
}
