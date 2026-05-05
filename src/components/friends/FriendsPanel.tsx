"use client";

/**
 * FriendsPanel — Discord-style friends UI for /channels/me.
 *
 * Tabs:
 *   - Online: ACCEPTED friends with status != OFFLINE
 *   - All:    ACCEPTED friends, alphabetical
 *   - Pending: incoming + outgoing PENDING requests with accept/decline
 *   - Add Friend: input to send a request by username
 *
 * Each accepted friend has a "Message" button that finds-or-creates a DM
 * channel via /api/dm and navigates into it.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTideCloak } from "@tidecloak/nextjs";
import {
  Users,
  Inbox,
  UserPlus,
  Check,
  X,
  MessageSquare,
  Trash2,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePresence } from "@/components/providers/PresenceProvider";
import { Avatar } from "@/components/Avatar";

interface FriendUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  accentColor?: string | null;
  status: "ONLINE" | "IDLE" | "DND" | "OFFLINE";
}

interface FriendEntry {
  id: string;
  status: "PENDING" | "ACCEPTED";
  createdAt: string;
  user: FriendUser;
}

type Tab = "online" | "all" | "pending" | "add";

export function FriendsPanel() {
  const { token } = useTideCloak();
  const router = useRouter();
  const { statuses } = usePresence();

  const [tab, setTab] = useState<Tab>("online");
  const [accepted, setAccepted] = useState<FriendEntry[]>([]);
  const [incoming, setIncoming] = useState<FriendEntry[]>([]);
  const [outgoing, setOutgoing] = useState<FriendEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/friends", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setAccepted(d.accepted ?? []);
      setIncoming(d.incoming ?? []);
      setOutgoing(d.outgoing ?? []);
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to load friends");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    fetchAll();
    // Poll every 20s so accepted/declined requests appear without a manual refresh.
    const t = window.setInterval(fetchAll, 20_000);
    // Re-fetch when this user (or someone we already see) edits their profile
    // so display names + avatars reflect immediately in the friends list.
    const onProfileSaved = () => fetchAll();
    window.addEventListener("zl:profile-saved", onProfileSaved);
    return () => {
      clearInterval(t);
      window.removeEventListener("zl:profile-saved", onProfileSaved);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const accept = async (id: string) => {
    if (!token) return;
    await fetch("/api/friends/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id }),
    });
    fetchAll();
  };
  const decline = async (id: string) => {
    if (!token) return;
    await fetch("/api/friends/decline", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id }),
    });
    fetchAll();
  };
  const remove = async (id: string) => {
    if (!token) return;
    if (!confirm("Remove this friend?")) return;
    await fetch(`/api/friends/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchAll();
  };

  const openDm = async (otherUserId: string) => {
    if (!token) return;
    const res = await fetch("/api/dm", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ targetUserId: otherUserId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || "Failed to open DM");
      return;
    }
    const { channelId } = await res.json();
    router.push(`/channels/me/${channelId}`);
  };

  // Use live presence to decide who's online; the User.status DB column is
  // never written so it's always OFFLINE there. The presence map reflects
  // currently-broadcasting peers in real-time.
  const liveStatusFor = (uid: string) => statuses.get(uid) ?? "OFFLINE";
  const onlineFriends = accepted.filter(
    (f) => liveStatusFor(f.user.id) !== "OFFLINE",
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-surface-100/20 px-4 shadow-sm">
        <Users className="mr-2 h-5 w-5 text-muted" />
        <span className="mr-3 font-semibold text-white">Friends</span>
        <TabBtn active={tab === "online"} onClick={() => setTab("online")}>
          Online{onlineFriends.length ? ` — ${onlineFriends.length}` : ""}
        </TabBtn>
        <TabBtn active={tab === "all"} onClick={() => setTab("all")}>
          All{accepted.length ? ` — ${accepted.length}` : ""}
        </TabBtn>
        <TabBtn active={tab === "pending"} onClick={() => setTab("pending")}>
          Pending
          {incoming.length > 0 && (
            <span className="ml-1.5 rounded-full bg-red-500 px-1.5 text-[10px] font-bold leading-tight text-white">
              {incoming.length}
            </span>
          )}
        </TabBtn>
        <TabBtn active={tab === "add"} onClick={() => setTab("add")} variant="green">
          <UserPlus className="mr-1 inline h-3.5 w-3.5" /> Add Friend
        </TabBtn>
      </header>

      {error && (
        <div className="border-b border-red-500/20 bg-red-500/10 px-4 py-1.5 text-xs text-red-400">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted" />
          </div>
        ) : tab === "add" ? (
          <AddFriendForm token={token ?? null} onAdded={fetchAll} />
        ) : tab === "pending" ? (
          <PendingList
            incoming={incoming}
            outgoing={outgoing}
            onAccept={accept}
            onDecline={decline}
          />
        ) : (
          <AcceptedList
            list={tab === "online" ? onlineFriends : accepted}
            emptyText={
              tab === "online"
                ? "No friends online right now."
                : accepted.length === 0
                  ? "No friends yet — try the Add Friend tab."
                  : "Nothing to show."
            }
            onMessage={openDm}
            onRemove={remove}
          />
        )}
      </div>
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────────────

function TabBtn({
  active,
  onClick,
  children,
  variant,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  variant?: "green";
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded px-2.5 py-1 text-sm font-medium transition-colors",
        active
          ? variant === "green"
            ? "bg-green-500 text-white"
            : "bg-surface-100 text-white"
          : "text-muted hover:bg-surface-100/40 hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

const STATUS_DOT: Record<string, string> = {
  ONLINE: "bg-green-500",
  IDLE: "bg-yellow-500",
  DND: "bg-red-500",
  OFFLINE: "bg-surface-400",
};

function FriendRow({
  user,
  rightSlot,
}: {
  user: FriendUser;
  rightSlot: React.ReactNode;
}) {
  const { statuses } = usePresence();
  const status = statuses.get(user.id) ?? "OFFLINE";
  const display = user.displayName || user.username;
  const statusLabel =
    status === "OFFLINE"
      ? "Offline"
      : status === "ONLINE"
        ? "Online"
        : status === "DND"
          ? "Do not disturb"
          : "Idle";
  return (
    <div className="flex items-center justify-between border-b border-surface-100/10 px-4 py-2.5 hover:bg-surface-100/30">
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative shrink-0">
          <Avatar user={user} size={36} />
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-surface-300",
              STATUS_DOT[status] ?? STATUS_DOT.OFFLINE,
            )}
          />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white">{display}</p>
          <p className="truncate text-xs text-muted">{statusLabel}</p>
        </div>
      </div>
      <div className="flex shrink-0 gap-1.5">{rightSlot}</div>
    </div>
  );
}

function AcceptedList({
  list,
  emptyText,
  onMessage,
  onRemove,
}: {
  list: FriendEntry[];
  emptyText: string;
  onMessage: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  if (list.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-20 text-sm text-muted">
        {emptyText}
      </div>
    );
  }
  return (
    <div>
      {list.map((f) => (
        <FriendRow
          key={f.id}
          user={f.user}
          rightSlot={
            <>
              <IconBtn onClick={() => onMessage(f.user.id)} title="Message">
                <MessageSquare className="h-4 w-4" />
              </IconBtn>
              <IconBtn onClick={() => onRemove(f.id)} title="Remove" danger>
                <Trash2 className="h-4 w-4" />
              </IconBtn>
            </>
          }
        />
      ))}
    </div>
  );
}

function PendingList({
  incoming,
  outgoing,
  onAccept,
  onDecline,
}: {
  incoming: FriendEntry[];
  outgoing: FriendEntry[];
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
}) {
  if (incoming.length === 0 && outgoing.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-20 text-sm text-muted">
        No pending requests.
      </div>
    );
  }
  return (
    <div>
      {incoming.length > 0 && (
        <>
          <SectionLabel>
            <Inbox className="h-3 w-3" /> Incoming — {incoming.length}
          </SectionLabel>
          {incoming.map((f) => (
            <FriendRow
              key={f.id}
              user={f.user}
              rightSlot={
                <>
                  <IconBtn onClick={() => onAccept(f.id)} title="Accept" success>
                    <Check className="h-4 w-4" />
                  </IconBtn>
                  <IconBtn onClick={() => onDecline(f.id)} title="Decline" danger>
                    <X className="h-4 w-4" />
                  </IconBtn>
                </>
              }
            />
          ))}
        </>
      )}
      {outgoing.length > 0 && (
        <>
          <SectionLabel>Outgoing — {outgoing.length}</SectionLabel>
          {outgoing.map((f) => (
            <FriendRow
              key={f.id}
              user={f.user}
              rightSlot={
                <IconBtn onClick={() => onDecline(f.id)} title="Cancel" danger>
                  <X className="h-4 w-4" />
                </IconBtn>
              }
            />
          ))}
        </>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">
      {children}
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  danger,
  success,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
  success?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
        danger
          ? "bg-surface-100 text-muted hover:bg-red-500/20 hover:text-red-400"
          : success
            ? "bg-surface-100 text-muted hover:bg-green-500/20 hover:text-green-400"
            : "bg-surface-100 text-muted hover:bg-brand/20 hover:text-brand",
      )}
    >
      {children}
    </button>
  );
}

function AddFriendForm({
  token,
  onAdded,
}: {
  token: string | null;
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const submit = async () => {
    const username = name.trim();
    if (!username || !token) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/friends/request", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ username }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setMsg({
        kind: "ok",
        text:
          body.status === "ACCEPTED"
            ? `You're now friends with ${username} 🎉`
            : `Friend request sent to ${username}.`,
      });
      setName("");
      onAdded();
    } catch (err: any) {
      setMsg({ kind: "err", text: err.message || "Failed to send request" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6">
      <h2 className="text-base font-bold text-white">Add Friend</h2>
      <p className="mt-1 text-sm text-muted">
        You can add a friend by their TideCloak username.
      </p>
      <div className="mt-4 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && submit()}
          placeholder="alice"
          disabled={busy}
          className="flex-1 rounded-lg bg-surface-100 px-3 py-2.5 text-sm text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand"
        />
        <button
          onClick={submit}
          disabled={!name.trim() || busy}
          className="flex items-center gap-1 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-brand/40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send"}
        </button>
      </div>
      {msg && (
        <div
          className={cn(
            "mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
            msg.kind === "ok"
              ? "bg-green-500/10 text-green-400"
              : "bg-red-500/10 text-red-400",
          )}
        >
          {msg.kind === "err" && <AlertCircle className="h-4 w-4 shrink-0" />}
          {msg.text}
        </div>
      )}
    </div>
  );
}
