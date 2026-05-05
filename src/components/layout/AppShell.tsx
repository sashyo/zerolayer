"use client";

import { useState, useEffect, useMemo } from "react";
import { usePathname } from "next/navigation";
import { useTideCloak } from "@tidecloak/nextjs";
import { ServerRail } from "./ServerRail";
import { ChannelSidebar } from "./ChannelSidebar";
import { MemberList } from "./MemberList";
import { Lightbox } from "@/components/chat/Lightbox";
import { ProfilePopover, openProfile } from "@/components/chat/ProfilePopover";
import { QuickSwitcher } from "@/components/layout/QuickSwitcher";
import { EditProfileModal } from "@/components/modals/EditProfileModal";
import { ToastHost } from "@/components/Toast";
import { useUnreadListener } from "@/hooks/useUnreadListener";
import { useUnread } from "@/components/providers/UnreadProvider";
import { useTabTitleBadge } from "@/hooks/useTabTitleBadge";
import { useKeys } from "@/components/providers/KeysProvider";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { setServersCache, setDmsCache } from "@/lib/serversCache";
import type { SerializedServer } from "@/types";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { token, getValueFromToken } = useTideCloak();
  const pathname = usePathname();
  const [servers, setServers] = useState<SerializedServer[]>([]);
  const [dmIds, setDmIds] = useState<string[]>([]);
  const [activeServer, setActiveServer] = useState<SerializedServer | null>(null);
  const [showMembers, setShowMembers] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!token) return;
    fetch("/api/servers", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(({ servers: s }) => {
        const list = s ?? [];
        setServers(list);
        // Mirror to the module-level cache so child route pages can resolve
        // server/channel metadata synchronously on first render.
        setServersCache(list);
      })
      .catch(console.warn);
  }, [token, refreshTick]);

  // Allow any descendant to request a refresh (e.g. ServerSettingsModal
  // saving a new name/icon, or EditProfileModal saving a new displayName /
  // avatar — those need to repaint member lists everywhere we render the
  // user's avatar).
  useEffect(() => {
    const onRefresh = () => setRefreshTick((t) => t + 1);
    window.addEventListener("zl:servers-refresh", onRefresh);
    window.addEventListener("zl:profile-saved", onRefresh);
    return () => {
      window.removeEventListener("zl:servers-refresh", onRefresh);
      window.removeEventListener("zl:profile-saved", onRefresh);
    };
  }, []);

  // Track DM channels so the unread listener can fire notifications for
  // every DM message (not just explicit @mentions).
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const refresh = () =>
      fetch("/api/dm", { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          const list = d.dms ?? [];
          setDmIds(list.map((x: { id: string }) => x.id));
          setDmsCache(list);
        })
        .catch(() => {});
    refresh();
    const t = window.setInterval(refresh, 20_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [token]);

  const userId = (getValueFromToken("sub") as string) ?? null;

  // Sync active server from URL: /channels/{serverId}/... or /servers/{serverId}/...
  useEffect(() => {
    if (servers.length === 0) return;
    const match = pathname.match(/^\/(?:channels|servers)\/([^/]+)/);
    const serverId = match?.[1];
    if (!serverId || serverId === "me") {
      setActiveServer(null);
      return;
    }
    const srv = servers.find((s) => s.id === serverId);
    if (srv) setActiveServer(srv);
  }, [pathname, servers]);

  // Subscribe to unread broadcasts for every channel I'm a member of (text
  // channels across all servers, plus DMs). The listener uses `dmIds` to
  // decide whether a new message should fire a "you have a new DM" toast.
  const allChannelIds = useMemo(() => {
    const ids: string[] = [];
    for (const s of servers) {
      for (const ch of s.channels) {
        if (ch.type !== "VOICE") ids.push(ch.id);
      }
    }
    for (const id of dmIds) ids.push(id);
    return ids;
  }, [servers, dmIds]);
  useUnreadListener(allChannelIds, dmIds);

  // Mark active channel as read whenever the URL points at one.
  const { markRead } = useUnread();
  useEffect(() => {
    const match = pathname.match(/^\/channels\/[^/]+\/([^/]+)$/);
    const channelId = match?.[1];
    if (channelId) markRead(channelId);
  }, [pathname, markRead]);

  // Reflect total mention count in the tab title (e.g. "(3) ZeroLayer").
  useTabTitleBadge();

  // Resolve a clicked @mention from any chat into a profile popover.
  // We look across the active server's members AND any DM participants we
  // can see — covers the common case without needing a global member index.
  useEffect(() => {
    const onMention = (e: Event) => {
      const detail = (e as CustomEvent<{ username: string }>).detail;
      const uname = detail?.username?.toLowerCase();
      if (!uname) return;
      const found = activeServer?.members.find(
        (m) => m.user.username?.toLowerCase() === uname,
      );
      if (found) {
        openProfile({
          id: found.userId,
          username: found.user.username,
          displayName: found.user.displayName,
        });
      }
    };
    window.addEventListener("zl:mention-click", onMention);
    return () => window.removeEventListener("zl:mention-click", onMention);
  }, [activeServer]);

  // Quick-switcher: Ctrl/Cmd+K opens an omnibox to jump to any channel/DM.
  const [switcherOpen, setSwitcherOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSwitcherOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Surface a keypair-bootstrap failure with a one-click retry. Without this,
  // a failed `IAMService.doEncrypt` leaves the user silently without a public
  // key, and every later action says "Public key not yet published for this
  // user" — but they have no idea the bootstrap failed.
  const keys = useKeys();

  return (
    <div className="flex h-screen overflow-hidden bg-surface-300 text-white">
      <ServerRail
        servers={servers}
        activeServerId={activeServer?.id ?? null}
        onSelectServer={(srv) => setActiveServer(srv)}
        onServersChange={setServers}
      />

      <ChannelSidebar
        server={activeServer}
        onToggleMembers={() => setShowMembers((v) => !v)}
      />

      <main className="flex flex-1 flex-col overflow-hidden">
        {keys.error && (
          <div className="flex items-center gap-3 border-b border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-xs text-yellow-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="flex-1">
              <strong className="font-semibold">E2EE keys couldn't be set up:</strong>{" "}
              {keys.error}. Until this succeeds, others can't send you E2EE messages
              and you'll see "Public key not yet published" errors.
            </span>
            <button
              onClick={() => keys.resetKeys()}
              className="flex items-center gap-1 rounded-md bg-yellow-500/20 px-2 py-1 font-medium text-yellow-100 hover:bg-yellow-500/30"
            >
              <RefreshCw className="h-3 w-3" />
              Retry
            </button>
          </div>
        )}
        {children}
      </main>

      {activeServer && showMembers && (
        <MemberList
          members={activeServer.members}
          serverId={activeServer.id}
          serverName={activeServer.name}
          isOwner={!!userId && activeServer.ownerId === userId}
          channels={activeServer.channels}
          onMemberAdded={() => setRefreshTick((t) => t + 1)}
        />
      )}

      <Lightbox />
      <ProfilePopover />
      <EditProfileModal />
      <ToastHost />

      {switcherOpen && (
        <QuickSwitcher
          servers={servers}
          onClose={() => setSwitcherOpen(false)}
        />
      )}
    </div>
  );
}
