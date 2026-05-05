"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Hash,
  Volume2,
  Plus,
  ChevronDown,
  Lock,
  UserPlus,
  Trash2,
  Users,
  Settings,
  LogOut,
  Bell,
  BellOff,
  Pencil,
  Bookmark,
} from "lucide-react";
import { useTideCloak } from "@tidecloak/nextjs";
import { cn } from "@/lib/utils";
import { CreateChannelModal } from "@/components/modals/CreateChannelModal";
import { InviteModal } from "@/components/modals/InviteModal";
import { DeleteServerModal } from "@/components/modals/DeleteServerModal";
import { ServerSettingsModal } from "@/components/modals/ServerSettingsModal";
import { CreateGroupDmModal } from "@/components/modals/CreateGroupDmModal";
import { useUnread } from "@/components/providers/UnreadProvider";
import { useChannelMutes } from "@/hooks/useChannelMutes";
import { useVoiceRoster } from "@/hooks/useVoiceRoster";
import { toggleChannelMute } from "@/lib/channelMutes";
import { setDmsCache } from "@/lib/serversCache";
import type { RosterEntry } from "@/lib/voiceRoster";
import { UserPanel } from "./UserPanel";
import type { SerializedServer, SerializedChannel } from "@/types";

interface ChannelSidebarProps {
  server: SerializedServer | null;
  onToggleMembers: () => void;
}

export function ChannelSidebar({ server, onToggleMembers }: ChannelSidebarProps) {
  const pathname = usePathname();
  const { getValueFromToken, token } = useTideCloak();
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [channels, setChannels] = useState<SerializedChannel[]>(
    server?.channels ?? [],
  );
  const [categories, setCategories] = useState(server?.categories ?? []);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = localStorage.getItem("zl:collapsedCategories");
      if (!raw) return new Set();
      const arr = JSON.parse(raw) as string[];
      return new Set(arr);
    } catch {
      return new Set();
    }
  });
  const persistCollapsed = (next: Set<string>) => {
    try {
      localStorage.setItem(
        "zl:collapsedCategories",
        JSON.stringify(Array.from(next)),
      );
    } catch {}
  };
  const toggleCollapsed = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      persistCollapsed(next);
      return next;
    });
  };

  useEffect(() => {
    setCategories(server?.categories ?? []);
  }, [server?.id, server?.categories]);

  const createCategory = async () => {
    if (!server || !token) return;
    const name = window.prompt("Category name");
    if (!name?.trim()) return;
    const res = await fetch(`/api/servers/${server.id}/categories`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!res.ok) return;
    const { category } = await res.json();
    setCategories((cs) => [...cs, category]);
  };

  const setChannelCategory = async (
    channelId: string,
    categoryId: string | null,
  ) => {
    if (!token) return;
    const res = await fetch(`/api/channels/${channelId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ categoryId }),
    });
    if (!res.ok) return;
    setChannels((prev) =>
      prev.map((c) => (c.id === channelId ? { ...c, categoryId } : c)),
    );
  };

  const deleteCategory = async (categoryId: string) => {
    if (!server || !token) return;
    if (!confirm("Delete this category? Channels inside will become uncategorized.")) return;
    const res = await fetch(
      `/api/servers/${server.id}/categories/${categoryId}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return;
    setCategories((cs) => cs.filter((c) => c.id !== categoryId));
    setChannels((prev) =>
      prev.map((c) => (c.categoryId === categoryId ? { ...c, categoryId: null } : c)),
    );
  };

  const renameCategory = async (categoryId: string, currentName: string) => {
    if (!server || !token) return;
    const name = window.prompt("Rename category", currentName);
    if (!name?.trim() || name.trim() === currentName) return;
    const res = await fetch(
      `/api/servers/${server.id}/categories/${categoryId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: name.trim() }),
      },
    );
    if (!res.ok) return;
    const { category } = await res.json();
    setCategories((cs) =>
      cs.map((c) => (c.id === categoryId ? { ...c, name: category.name } : c)),
    );
  };

  // Close the dropdown on outside click / Escape
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [menuOpen]);

  // Keep the local channel list in sync with the active server. The previous
  // logic only seeded once (when channels.length === 0), so switching servers
  // left the sidebar showing the *old* server's channels and made clicks
  // navigate to /channels/<newServer>/<oldChannelId> → "Channel not found".
  useEffect(() => {
    setChannels(server?.channels ?? []);
  }, [server?.id, server?.channels]);

  const persistReorder = (ids: string[]) => {
    if (!server || !token) return;
    void fetch(`/api/servers/${server.id}/channels/reorder`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        positions: ids.map((id, idx) => ({ id, position: idx })),
      }),
    }).catch(() => {});
  };

  // Reorder helper called from ChannelGroup on drop. We update local state
  // optimistically — the next /api/servers refresh will reconcile.
  const reorderWithin = (sourceId: string, targetId: string) => {
    setChannels((prev) => {
      const next = [...prev];
      const from = next.findIndex((c) => c.id === sourceId);
      const to = next.findIndex((c) => c.id === targetId);
      if (from < 0 || to < 0) return prev;
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      // Persist position based on the channels of this type only — the API
      // accepts a flat `positions` array; we send the whole list so the
      // server's idea of order matches what the client just rendered.
      persistReorder(next.map((c) => c.id));
      return next;
    });
  };

  const textChannels = channels.filter((c) => c.type === "TEXT");
  const voiceChannels = channels.filter((c) => c.type === "VOICE");
  const userId = (getValueFromToken("sub") as string) ?? null;
  const isOwner = !!server && !!userId && server.ownerId === userId;
  const roster = useVoiceRoster();

  // Build a userId → display lookup from this server's members so the
  // roster can show real names rather than ids.
  const memberDisplay = (id: string): string => {
    const m = server?.members.find((mm) => mm.userId === id);
    return m?.user.displayName || m?.user.username || id.slice(0, 6);
  };

  return (
    <aside className="flex w-60 flex-col bg-surface-200">
      {/* Server header */}
      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => server && setMenuOpen((v) => !v)}
          disabled={!server}
          className="flex h-12 w-full items-center justify-between border-b border-surface-100/20 px-4 text-left shadow-sm transition-colors enabled:hover:bg-surface-100/40 disabled:cursor-default"
          title={server ? "Server menu" : undefined}
        >
          <span className="truncate font-semibold text-white">
            {server?.name ?? "Direct Messages"}
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted transition-transform",
              menuOpen && "rotate-180",
            )}
          />
        </button>

        {menuOpen && server && (
          <div className="absolute left-2 right-2 top-full z-30 mt-1 overflow-hidden rounded-lg bg-surface-100 shadow-xl ring-1 ring-black/40">
            {isOwner && (
              <>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setShowInvite(true);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white hover:bg-brand/20"
                >
                  <UserPlus className="h-4 w-4 text-muted" />
                  Invite People
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setShowSettings(true);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white hover:bg-brand/20"
                >
                  <Settings className="h-4 w-4 text-muted" />
                  Server Settings
                </button>
                <div className="h-px bg-white/5" />
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setShowDelete(true);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-400 hover:bg-red-500/10"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete Server
                </button>
              </>
            )}
            {!isOwner && (
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setShowSettings(true);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-400 hover:bg-red-500/10"
              >
                <LogOut className="h-4 w-4" />
                Leave Server
              </button>
            )}
          </div>
        )}
      </div>

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {server ? (
          <>
            {(() => {
              const uncategorized = textChannels.filter(
                (c) => !c.categoryId || !categories.find((cat) => cat.id === c.categoryId),
              );
              return (
                <>
                  {uncategorized.length > 0 && (
                    <ChannelGroup
                      label="Text Channels"
                      channels={uncategorized}
                      pathname={pathname}
                      serverId={server.id}
                      onAdd={isOwner ? () => setShowCreateChannel(true) : undefined}
                      onAddCategory={isOwner ? createCategory : undefined}
                      isOwner={isOwner}
                      categories={categories}
                      onSetCategory={setChannelCategory}
                      onReorder={reorderWithin}
                      onChannelRenamed={(updated) =>
                        setChannels((prev) =>
                          prev.map((c) =>
                            c.id === updated.id
                              ? { ...c, name: updated.name }
                              : c,
                          ),
                        )
                      }
                    />
                  )}
                  {categories.map((cat) => {
                    const inCat = textChannels.filter((c) => c.categoryId === cat.id);
                    const isCollapsed = collapsed.has(cat.id);
                    return (
                      <ChannelGroup
                        key={cat.id}
                        label={cat.name}
                        channels={isCollapsed ? [] : inCat}
                        pathname={pathname}
                        serverId={server.id}
                        onAdd={isOwner ? () => setShowCreateChannel(true) : undefined}
                        isOwner={isOwner}
                        categories={categories}
                        onSetCategory={setChannelCategory}
                        onReorder={reorderWithin}
                        onChannelRenamed={(updated) =>
                          setChannels((prev) =>
                            prev.map((c) =>
                              c.id === updated.id
                                ? { ...c, name: updated.name }
                                : c,
                            ),
                          )
                        }
                        collapsible
                        collapsed={isCollapsed}
                        onToggleCollapsed={() => toggleCollapsed(cat.id)}
                        onRenameCategory={
                          isOwner ? () => renameCategory(cat.id, cat.name) : undefined
                        }
                        onDeleteCategory={
                          isOwner ? () => deleteCategory(cat.id) : undefined
                        }
                      />
                    );
                  })}
                </>
              );
            })()}
            {voiceChannels.length > 0 && (
              <ChannelGroup
                label="Voice Channels"
                channels={voiceChannels}
                pathname={pathname}
                serverId={server.id}
                onAdd={() => setShowCreateChannel(true)}
                isOwner={isOwner}
                roster={roster}
                memberDisplay={memberDisplay}
                onReorder={reorderWithin}
                onChannelRenamed={(updated) =>
                  setChannels((prev) =>
                    prev.map((c) =>
                      c.id === updated.id ? { ...c, name: updated.name } : c,
                    ),
                  )
                }
              />
            )}
          </>
        ) : (
          <DMList />
        )}
      </div>

      {/* User panel */}
      <UserPanel onToggleMembers={onToggleMembers} />

      {server && (
        <CreateChannelModal
          serverId={server.id}
          open={showCreateChannel}
          onClose={() => setShowCreateChannel(false)}
          onCreated={(ch) => setChannels((prev) => [...prev, ch])}
        />
      )}

      {server && isOwner && (
        <InviteModal
          serverName={server.name}
          inviteCode={server.inviteCode}
          open={showInvite}
          onClose={() => setShowInvite(false)}
        />
      )}

      {server && isOwner && (
        <DeleteServerModal
          serverId={server.id}
          serverName={server.name}
          open={showDelete}
          onClose={() => setShowDelete(false)}
        />
      )}

      {server && (
        <ServerSettingsModal
          serverId={server.id}
          serverName={server.name}
          serverIconUrl={server.iconUrl}
          channelIds={channels.map((c) => c.id)}
          isOwner={isOwner}
          open={showSettings}
          onClose={() => setShowSettings(false)}
          onUpdated={() => {
            // Force a fresh /api/servers fetch via the AppShell so the rail
            // and member list pick up the new name/icon.
            window.dispatchEvent(new CustomEvent("zl:servers-refresh"));
          }}
        />
      )}
    </aside>
  );
}

function ChannelGroup({
  label,
  channels,
  pathname,
  serverId,
  onAdd,
  onAddCategory,
  isOwner,
  roster,
  memberDisplay,
  onReorder,
  onChannelRenamed,
  collapsible,
  collapsed,
  onToggleCollapsed,
  onRenameCategory,
  onDeleteCategory,
  categories,
  onSetCategory,
}: {
  label: string;
  channels: SerializedChannel[];
  pathname: string;
  serverId: string;
  onAdd?: () => void;
  onAddCategory?: () => void;
  isOwner: boolean;
  roster?: Map<string, RosterEntry[]>;
  memberDisplay?: (userId: string) => string;
  onReorder?: (sourceId: string, targetId: string) => void;
  onChannelRenamed?: (updated: { id: string; name: string }) => void;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onRenameCategory?: () => void;
  onDeleteCategory?: () => void;
  categories?: Array<{ id: string; name: string }>;
  onSetCategory?: (channelId: string, categoryId: string | null) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  return (
    <div className="mb-4">
      <div
        className={cn(
          "group flex items-center justify-between px-1 py-1",
          collapsible && "cursor-pointer",
        )}
        onClick={collapsible ? onToggleCollapsed : undefined}
      >
        <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted">
          {collapsible && (
            <ChevronDown
              className={cn(
                "h-3 w-3 transition-transform",
                collapsed && "-rotate-90",
              )}
            />
          )}
          {label}
        </span>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {onRenameCategory && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRenameCategory();
              }}
              className="text-muted hover:text-white"
              title="Rename category"
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
          {onDeleteCategory && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDeleteCategory();
              }}
              className="text-muted hover:text-red-400"
              title="Delete category"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
          {onAddCategory && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAddCategory();
              }}
              className="text-muted hover:text-white"
              title="New Category"
            >
              <span className="font-mono text-[10px]">+CAT</span>
            </button>
          )}
          {isOwner && onAdd && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAdd();
              }}
              className="text-muted hover:text-white"
              title="Create Channel"
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {channels.map((ch) => {
        const occupants = roster?.get(ch.id) ?? [];
        const dragHandlers = isOwner && onReorder
          ? {
              draggable: true,
              onDragStart: (e: React.DragEvent) => {
                setDragId(ch.id);
                e.dataTransfer.effectAllowed = "move";
                try {
                  e.dataTransfer.setData("text/plain", ch.id);
                } catch {}
              },
              onDragEnd: () => {
                setDragId(null);
                setDragOverId(null);
              },
              onDragOver: (e: React.DragEvent) => {
                if (!dragId || dragId === ch.id) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDragOverId(ch.id);
              },
              onDragLeave: () => {
                setDragOverId((cur) => (cur === ch.id ? null : cur));
              },
              onDrop: (e: React.DragEvent) => {
                e.preventDefault();
                const sourceId = dragId ?? e.dataTransfer.getData("text/plain");
                if (sourceId && sourceId !== ch.id) onReorder(sourceId, ch.id);
                setDragId(null);
                setDragOverId(null);
              },
            }
          : {};
        return (
          <ChannelLink
            key={ch.id}
            channel={ch}
            serverId={serverId}
            pathname={pathname}
            isOwner={isOwner}
            occupants={occupants}
            memberDisplay={memberDisplay}
            dragHandlers={dragHandlers}
            isDragSource={dragId === ch.id}
            isDragTarget={dragOverId === ch.id}
            categories={categories}
            onSetCategory={onSetCategory}
            onRenamed={onChannelRenamed}
          />
        );
      })}
    </div>
  );
}

function ChannelLink({
  channel: ch,
  serverId,
  pathname,
  isOwner,
  occupants = [],
  memberDisplay,
  dragHandlers,
  isDragSource,
  isDragTarget,
  categories,
  onSetCategory,
  onRenamed,
}: {
  channel: SerializedChannel;
  serverId: string;
  pathname: string;
  isOwner?: boolean;
  occupants?: RosterEntry[];
  memberDisplay?: (userId: string) => string;
  dragHandlers?: Record<string, unknown>;
  isDragSource?: boolean;
  isDragTarget?: boolean;
  categories?: Array<{ id: string; name: string }>;
  onSetCategory?: (channelId: string, categoryId: string | null) => void;
  onRenamed?: (updated: { id: string; name: string }) => void;
}) {
  const { token } = useTideCloak();
  const href = `/channels/${serverId}/${ch.id}`;
  const active = pathname === href;
  const Icon = ch.type === "VOICE" ? Volume2 : ch.isPrivate ? Lock : Hash;
  const { unread, mentions } = useUnread();
  const muted = useChannelMutes();
  const isMuted = muted.has(ch.id);
  const isUnread = unread.has(ch.id) && !active;
  const mentionCount = mentions.get(ch.id) ?? 0;
  const showMentionBadge = mentionCount > 0 && !active && !isMuted;
  // Multiple tabs of the same user count once.
  const uniqueOccupants = Array.from(new Set(occupants.map((o) => o.userId)));
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(ch.name);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const saveRename = async () => {
    if (!token) return;
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === ch.name) {
      setEditing(false);
      return;
    }
    setEditing(false);
    try {
      const res = await fetch(`/api/channels/${ch.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) return;
      const { channel } = await res.json();
      onRenamed?.({ id: channel.id, name: channel.name });
    } catch {}
  };

  const linkInner = (
    <div
      {...(dragHandlers ?? {})}
      className={cn(
        "channel-item",
        active && "active",
        isUnread && !isMuted && "font-semibold text-white",
        isMuted && "opacity-60",
        isDragSource && "opacity-40",
        isDragTarget && "ring-1 ring-brand",
      )}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {editing ? (
        <input
          autoFocus
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={saveRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              saveRename();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
              setDraftName(ch.name);
            }
          }}
          maxLength={100}
          className="flex-1 bg-transparent text-sm text-white focus:outline-none"
        />
      ) : (
        <span className="truncate text-sm">{ch.name}</span>
      )}
      {isMuted && (
        <BellOff className="h-3 w-3 shrink-0 text-muted" aria-label="Muted" />
      )}
      {ch.type === "VOICE" && uniqueOccupants.length > 0 ? (
        <span className="ml-auto inline-flex h-4 min-w-[1rem] shrink-0 items-center justify-center rounded-full bg-green-500/20 px-1.5 text-[10px] font-semibold text-green-300">
          {uniqueOccupants.length}
        </span>
      ) : showMentionBadge ? (
        <span className="ml-auto inline-flex h-4 min-w-[1rem] shrink-0 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
          {mentionCount > 99 ? "99+" : mentionCount}
        </span>
      ) : isUnread && !isMuted ? (
        <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-red-500" />
      ) : null}
    </div>
  );

  return (
    <>
      {editing ? (
        // While renaming, don't navigate on click; the input owns the row.
        linkInner
      ) : (
        <Link href={href}>{linkInner}</Link>
      )}
      {ch.type === "VOICE" && uniqueOccupants.length > 0 && (
        <ul className="mb-1 ml-7 mt-0.5 space-y-0.5">
          {uniqueOccupants.slice(0, 8).map((userId) => {
            const display = memberDisplay?.(userId) ?? userId.slice(0, 6);
            const initials = display.slice(0, 2).toUpperCase();
            return (
              <li
                key={userId}
                className="flex items-center gap-1.5 truncate text-xs text-muted"
                title={display}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand text-[8px] font-bold text-white">
                  {initials}
                </span>
                <span className="truncate">{display}</span>
              </li>
            );
          })}
          {uniqueOccupants.length > 8 && (
            <li className="ml-5 text-[10px] text-muted">
              +{uniqueOccupants.length - 8} more
            </li>
          )}
        </ul>
      )}
      {menu && (
        <div
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
          className="fixed z-[70] w-48 overflow-hidden rounded-md bg-surface-100 py-1 shadow-2xl ring-1 ring-black/40"
        >
          <button
            type="button"
            onClick={() => {
              toggleChannelMute(ch.id);
              setMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-white hover:bg-brand/20"
          >
            {isMuted ? (
              <Bell className="h-4 w-4" />
            ) : (
              <BellOff className="h-4 w-4" />
            )}
            {isMuted ? "Unmute Channel" : "Mute Channel"}
          </button>
          {isOwner && ch.type !== "VOICE" && (
            <button
              type="button"
              onClick={() => {
                setDraftName(ch.name);
                setEditing(true);
                setMenu(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-white hover:bg-brand/20"
            >
              <Pencil className="h-4 w-4" />
              Rename Channel
            </button>
          )}
          {isOwner && categories && onSetCategory && (
            <>
              <div className="my-1 h-px bg-white/5" />
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                Move to Category
              </div>
              <button
                type="button"
                onClick={() => {
                  onSetCategory(ch.id, null);
                  setMenu(null);
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-brand/20",
                  ch.categoryId === null
                    ? "text-brand"
                    : "text-white",
                )}
              >
                None
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    onSetCategory(ch.id, cat.id);
                    setMenu(null);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-brand/20",
                    ch.categoryId === cat.id ? "text-brand" : "text-white",
                  )}
                >
                  {cat.name}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </>
  );
}

interface DmEntry {
  id: string;
  type: string;
  name?: string;
  participants: Array<{
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    status: string;
  }>;
}

function DMList() {
  const { token, getValueFromToken } = useTideCloak();
  const muted = useChannelMutes();
  const pathname = usePathname();
  const { unread } = useUnread();
  const [dms, setDms] = useState<DmEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const mySub = (getValueFromToken("sub") as string) ?? "";

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const fetchDms = () =>
      fetch("/api/dm", { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.json())
        .then((d) => {
          if (!cancelled) {
            const list = d.dms ?? [];
            setDms(list);
            setDmsCache(list);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    fetchDms();
    // Refresh periodically so new DMs appear without manual refresh.
    const t = window.setInterval(fetchDms, 20_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [token]);

  return (
    <div>
      <div className="group flex items-center justify-between px-1 py-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          Direct Messages
        </span>
        <button
          onClick={() => setShowGroupModal(true)}
          className="text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-white"
          title="New Group DM"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <Link href="/channels/me">
        <div
          className={cn(
            "channel-item",
            pathname === "/channels/me" && "active",
          )}
        >
          <Users className="h-4 w-4 shrink-0" />
          <span className="truncate text-sm">Friends</span>
        </div>
      </Link>
      <Link href="/channels/me/saved">
        <div
          className={cn(
            "channel-item",
            pathname === "/channels/me/saved" && "active",
          )}
        >
          <Bookmark className="h-4 w-4 shrink-0" />
          <span className="truncate text-sm">Saved Messages</span>
        </div>
      </Link>
      {loading ? null : dms.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted">
          No conversations yet — add a friend and message them.
        </p>
      ) : (
        dms.map((d) => {
          const isGroup = d.type === "GROUP_DM";
          const others = d.participants.filter((p) => p.id !== mySub);
          let display: string;
          let initials: string;
          if (isGroup) {
            display =
              (d as unknown as { name?: string }).name ||
              others.map((p) => p.displayName || p.username).join(", ").slice(0, 60) ||
              "Group DM";
            initials = display.slice(0, 2).toUpperCase();
          } else {
            const other = d.participants.find((p) => p.id !== mySub);
            if (!other) return null;
            display = other.displayName || other.username;
            initials = display.slice(0, 2).toUpperCase();
          }
          const href = `/channels/me/${d.id}`;
          const active = pathname === href;
          const isUnread = unread.has(d.id) && !active;
          return (
            <DmRow
              key={d.id}
              dmId={d.id}
              isGroup={isGroup}
              display={display}
              initials={initials}
              href={href}
              active={active}
              isUnread={isUnread}
              isMuted={muted.has(d.id)}
              token={token ?? null}
              onClosed={() => setDms((prev) => prev.filter((x) => x.id !== d.id))}
            />
          );
        })
      )}
      <CreateGroupDmModal
        open={showGroupModal}
        onClose={() => setShowGroupModal(false)}
      />
    </div>
  );
}

function DmRow({
  dmId,
  isGroup,
  display,
  initials,
  href,
  active,
  isUnread,
  isMuted,
  token,
  onClosed,
}: {
  dmId: string;
  isGroup: boolean;
  display: string;
  initials: string;
  href: string;
  active: boolean;
  isUnread: boolean;
  isMuted: boolean;
  token: string | null;
  onClosed: () => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const closeDm = async () => {
    if (!token) return;
    if (
      !confirm(
        isGroup
          ? `Leave the group "${display}"? You'll lose access to its messages.`
          : `Close DM with ${display}? You can always re-open it later.`,
      )
    )
      return;
    const res = await fetch(`/api/dm/${dmId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) onClosed();
  };

  return (
    <>
      <Link href={href}>
        <div
          className={cn(
            "channel-item gap-2",
            active && "active",
            isUnread && !isMuted && "font-semibold text-white",
            isMuted && "opacity-60",
          )}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY });
          }}
        >
          {isGroup ? (
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-400 text-muted">
              <Users className="h-3 w-3" />
            </div>
          ) : (
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white">
              {initials}
            </div>
          )}
          <span className="truncate text-sm">{display}</span>
          {isMuted && (
            <BellOff
              className="h-3 w-3 shrink-0 text-muted"
              aria-label="Muted"
            />
          )}
          {isUnread && !isMuted && (
            <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-red-500" />
          )}
        </div>
      </Link>
      {menu && (
        <div
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
          className="fixed z-[70] w-48 overflow-hidden rounded-md bg-surface-100 py-1 shadow-2xl ring-1 ring-black/40"
        >
          <button
            type="button"
            onClick={() => {
              toggleChannelMute(dmId);
              setMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-white hover:bg-brand/20"
          >
            {isMuted ? (
              <Bell className="h-4 w-4" />
            ) : (
              <BellOff className="h-4 w-4" />
            )}
            {isMuted ? "Unmute" : "Mute"}
          </button>
          <div className="my-1 h-px bg-white/5" />
          <button
            type="button"
            onClick={() => {
              setMenu(null);
              void closeDm();
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-red-400 hover:bg-red-500/10"
          >
            <Trash2 className="h-4 w-4" />
            {isGroup ? "Leave Group" : "Close DM"}
          </button>
        </div>
      )}
    </>
  );
}
