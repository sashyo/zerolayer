"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageSquare, Plus, Compass } from "lucide-react";
import { cn } from "@/lib/utils";
import { CreateServerModal } from "@/components/modals/CreateServerModal";
import { JoinServerModal } from "@/components/modals/JoinServerModal";
import { useUnread } from "@/components/providers/UnreadProvider";
import type { SerializedServer } from "@/types";

const ORDER_KEY = "zl:serverOrder";

function readOrder(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as string[]) : [];
  } catch {
    return [];
  }
}

function writeOrder(ids: string[]) {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(ids));
  } catch {}
}

interface ServerRailProps {
  servers: SerializedServer[];
  activeServerId: string | null;
  onSelectServer: (server: SerializedServer) => void;
  onServersChange: (servers: SerializedServer[]) => void;
}

export function ServerRail({
  servers,
  activeServerId,
  onSelectServer,
  onServersChange,
}: ServerRailProps) {
  const router = useRouter();
  const { unread, mentions } = useUnread();
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);

  // Per-server aggregates: total mentions across that server's channels and
  // whether any channel is currently unread. Drives the rail-icon badges.
  const serverStats = useMemo(() => {
    const map = new Map<string, { unread: boolean; mentions: number }>();
    for (const s of servers) {
      let m = 0;
      let u = false;
      for (const ch of s.channels) {
        if (ch.type === "VOICE") continue;
        if (unread.has(ch.id)) u = true;
        m += mentions.get(ch.id) ?? 0;
      }
      map.set(s.id, { unread: u, mentions: m });
    }
    return map;
  }, [servers, unread, mentions]);

  // User-defined ordering, persisted to localStorage. We start by mirroring
  // the server's order, then apply the saved sequence on top so newly-joined
  // servers default to the bottom.
  const [order, setOrder] = useState<string[]>(() => readOrder());
  useEffect(() => {
    setOrder((prev) => {
      const known = new Set(servers.map((s) => s.id));
      const filtered = prev.filter((id) => known.has(id));
      const stored = new Set(filtered);
      const appended = servers.filter((s) => !stored.has(s.id)).map((s) => s.id);
      return filtered.concat(appended);
    });
  }, [servers]);

  const orderedServers = useMemo(() => {
    const byId = new Map(servers.map((s) => [s.id, s] as const));
    const out: SerializedServer[] = [];
    for (const id of order) {
      const s = byId.get(id);
      if (s) out.push(s);
    }
    // Catch any server not yet in `order` (race during initial hydration).
    for (const s of servers) if (!order.includes(s.id)) out.push(s);
    return out;
  }, [servers, order]);

  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const moveServer = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    setOrder((prev) => {
      const cur = prev.length === 0 ? servers.map((s) => s.id) : [...prev];
      const from = cur.indexOf(sourceId);
      const to = cur.indexOf(targetId);
      if (from < 0 || to < 0) return prev;
      cur.splice(from, 1);
      cur.splice(to, 0, sourceId);
      writeOrder(cur);
      return cur;
    });
  };

  // Selecting a server should *navigate* to its first text channel — without
  // this, the main pane stays on whatever URL we last had (a channel from a
  // different server, or /channels/me) until the user manually clicks one.
  const handleSelectServer = (srv: SerializedServer) => {
    onSelectServer(srv);
    const first =
      srv.channels.find((c) => c.type === "TEXT") ?? srv.channels[0];
    if (first) router.push(`/channels/${srv.id}/${first.id}`);
    else router.push(`/channels/${srv.id}`);
  };

  return (
    <nav
      className="flex w-[72px] flex-col items-center gap-2 overflow-y-auto
                 bg-surface-100 py-3 scrollbar-none"
    >
      {/* DMs shortcut */}
      <RailTooltip label="Direct Messages">
        <Link href="/channels/me">
          <div
            className={cn(
              "server-icon",
              !activeServerId && "rounded-xl bg-brand",
            )}
          >
            <MessageSquare className="h-5 w-5" />
          </div>
        </Link>
      </RailTooltip>

      <Separator />

      {/* Server icons — drag to reorder */}
      {orderedServers.map((srv) => {
        const stat = serverStats.get(srv.id);
        const showUnread = stat?.unread && activeServerId !== srv.id;
        const mentionCount = stat?.mentions ?? 0;
        return (
        <RailTooltip key={srv.id} label={srv.name}>
        <div className="relative">
        <button
          onClick={() => handleSelectServer(srv)}
          draggable
          onDragStart={(e) => {
            setDragId(srv.id);
            e.dataTransfer.effectAllowed = "move";
            try {
              e.dataTransfer.setData("text/plain", srv.id);
            } catch {}
          }}
          onDragEnd={() => {
            setDragId(null);
            setDragOverId(null);
          }}
          onDragOver={(e) => {
            if (!dragId || dragId === srv.id) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDragOverId(srv.id);
          }}
          onDragLeave={() => {
            setDragOverId((cur) => (cur === srv.id ? null : cur));
          }}
          onDrop={(e) => {
            e.preventDefault();
            const sourceId = dragId ?? e.dataTransfer.getData("text/plain");
            if (sourceId) moveServer(sourceId, srv.id);
            setDragId(null);
            setDragOverId(null);
          }}
          className={cn(
            "server-icon transition-transform",
            activeServerId === srv.id && "rounded-xl bg-brand",
            dragId === srv.id && "opacity-40",
            dragOverId === srv.id && "ring-2 ring-brand ring-offset-2 ring-offset-surface-100",
          )}
        >
          {srv.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={srv.iconUrl}
              alt={srv.name}
              className="h-full w-full rounded-[inherit] object-cover"
            />
          ) : (
            <span className="text-sm font-bold">{acronym(srv.name)}</span>
          )}
        </button>
          {showUnread && mentionCount === 0 && (
            <span
              className="pointer-events-none absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-white"
              aria-label="Unread"
            />
          )}
          {mentionCount > 0 && (
            <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-surface-100">
              {mentionCount > 99 ? "99+" : mentionCount}
            </span>
          )}
        </div>
        </RailTooltip>
        );
      })}

      <Separator />

      {/* Add server */}
      <RailTooltip label="Create a Server">
        <button
          onClick={() => setShowCreate(true)}
          className="server-icon text-green-400 hover:bg-green-500 hover:text-white"
        >
          <Plus className="h-5 w-5" />
        </button>
      </RailTooltip>

      {/* Join via invite */}
      <RailTooltip label="Join a Server">
      <button
        onClick={() => setShowJoin(true)}
        className="server-icon text-green-400 hover:bg-green-500 hover:text-white"
      >
        <Compass className="h-5 w-5" />
      </button>
      </RailTooltip>

      <CreateServerModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(srv) => {
          onServersChange([...servers, srv]);
          handleSelectServer(srv);
          setShowCreate(false);
        }}
      />

      <JoinServerModal
        open={showJoin}
        onClose={() => setShowJoin(false)}
        onJoined={() => setShowJoin(false)}
      />
    </nav>
  );
}

/** Discord-style sticky tooltip — appears to the right of a rail item on
 *  hover, with a tiny arrow. Pure CSS via the `group` modifier so we don't
 *  need any JS state for positioning. */
function RailTooltip({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="group relative">
      {children}
      <span
        className="pointer-events-none absolute left-full top-1/2 z-40 ml-3 -translate-y-1/2
                   whitespace-nowrap rounded-md bg-surface-100 px-2 py-1 text-xs font-medium
                   text-white opacity-0 shadow-lg ring-1 ring-black/40 transition-opacity
                   delay-150 group-hover:opacity-100"
      >
        {label}
      </span>
    </div>
  );
}

function Separator() {
  return <div className="mx-auto h-px w-8 bg-surface-400" />;
}

function acronym(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}
