"use client";

import { use, useEffect, useState } from "react";
import { useTideCloak } from "@tidecloak/nextjs";
import { DmChannelArea } from "@/components/chat/DmChannelArea";
import { GroupDmChannelArea } from "@/components/chat/GroupDmChannelArea";
import { Loader2 } from "lucide-react";
import { getDmsCache } from "@/lib/serversCache";

interface DmChannelPageProps {
  params: Promise<{ channelId: string }>;
}

interface ResolvedDm {
  type: "DM" | "GROUP_DM";
  // 1:1 DMs
  userId?: string;
  displayName: string;
  // Group DMs
  participantCount?: number;
}

function resolveDm(channelId: string, mySub: string): ResolvedDm | null {
  const dms = getDmsCache();
  const dm = dms.find((d) => d.id === channelId);
  if (!dm) return null;
  const isGroup = (dm as { type?: string }).type === "GROUP_DM";
  if (isGroup) {
    const others = dm.participants.filter((p) => p.id !== mySub);
    const display =
      (dm as { name?: string }).name ||
      others.map((p) => p.displayName || p.username).join(", ").slice(0, 60);
    return {
      type: "GROUP_DM",
      displayName: display || "Group DM",
      participantCount: dm.participants.length,
    };
  }
  const o = dm.participants.find((p) => p.id !== mySub);
  if (!o) return null;
  return {
    type: "DM",
    userId: o.id,
    displayName: o.displayName || o.username,
  };
}

export default function DmChannelPage({ params }: DmChannelPageProps) {
  const { channelId } = use(params);
  const { token, getValueFromToken } = useTideCloak();
  const mySub = (getValueFromToken("sub") as string) ?? "";
  const seed = resolveDm(channelId, mySub);
  const [resolved, setResolved] = useState<ResolvedDm | null>(seed);
  const [loading, setLoading] = useState(!seed);
  const [notFound, setNotFound] = useState(false);

  // Re-seed on channelId change so cached switches are instant.
  useEffect(() => {
    const fresh = resolveDm(channelId, mySub);
    setResolved(fresh);
    setLoading(!fresh);
    setNotFound(false);
  }, [channelId, mySub]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch("/api/dm", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(({ dms }) => {
        if (cancelled) return;
        const dm = dms?.find((d: any) => d.id === channelId);
        if (!dm) {
          setNotFound(true);
          return;
        }
        if (dm.type === "GROUP_DM") {
          const others = dm.participants.filter((p: any) => p.id !== mySub);
          const display =
            dm.name ||
            others
              .map((p: any) => p.displayName || p.username)
              .join(", ")
              .slice(0, 60);
          setResolved({
            type: "GROUP_DM",
            displayName: display || "Group DM",
            participantCount: dm.participants.length,
          });
          return;
        }
        const otherP = dm.participants.find((p: any) => p.id !== mySub);
        if (!otherP) {
          setNotFound(true);
          return;
        }
        setResolved({
          type: "DM",
          userId: otherP.id,
          displayName: otherP.displayName || otherP.username,
        });
      })
      .catch(console.warn)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [channelId, token, mySub]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (notFound || !resolved) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted">
        Direct message not found
      </div>
    );
  }

  if (resolved.type === "GROUP_DM") {
    return (
      <GroupDmChannelArea
        key={channelId}
        channelId={channelId}
        groupName={resolved.displayName}
        participantCount={resolved.participantCount ?? 0}
      />
    );
  }

  return (
    <DmChannelArea
      key={channelId}
      channelId={channelId}
      otherUserId={resolved.userId!}
      otherDisplayName={resolved.displayName}
    />
  );
}
