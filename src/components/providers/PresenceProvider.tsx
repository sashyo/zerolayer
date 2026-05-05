"use client";

/**
 * PresenceProvider — global online/idle/dnd/offline status broadcast.
 *
 * Joins a single Supabase Realtime channel `presence:global`, tracks the
 * caller's status under their TideCloak `sub` as the presence key, and
 * exposes a Map<userId, status> via context. Anyone rendering a user pip
 * (member list, friends panel, DM list) reads from here and gets live
 * updates.
 *
 * Idle detection: if the document is hidden OR there has been no
 * keyboard/mouse activity for IDLE_AFTER_MS, status flips from ONLINE to
 * IDLE. DND is a manual override.
 *
 * No DB writes — presence is ephemeral. The User.status column in the schema
 * is left at OFFLINE; live state lives in Supabase Presence and only as long
 * as the user has a tab open.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTideCloak } from "@tidecloak/nextjs";
import { getSupabase } from "@/lib/supabase";

export type PresenceStatus = "ONLINE" | "IDLE" | "DND" | "OFFLINE";

const IDLE_AFTER_MS = 5 * 60 * 1000;

interface PresenceContextValue {
  /** Live status for every user currently broadcasting on the global channel. */
  statuses: Map<string, PresenceStatus>;
  /** Free-text custom status per user, also broadcast via Presence. */
  customStatuses: Map<string, string>;
  /** This user's effective status (auto-derived ONLINE/IDLE unless DND is set). */
  myStatus: PresenceStatus;
  /** This user's free-text status (persists in localStorage, broadcast live). */
  myCustomStatus: string;
  /** Set DND on/off. ONLINE/IDLE auto-derives — DND wins when set. */
  setDnd: (on: boolean) => void;
  /** Update this user's custom status (max 60 chars). */
  setCustomStatus: (text: string) => void;
  isDnd: boolean;
}

const CUSTOM_STATUS_KEY = "zl:customStatus";
const MAX_CUSTOM_STATUS = 60;

const Ctx = createContext<PresenceContextValue | null>(null);

export function PresenceProvider({ children }: { children: ReactNode }) {
  const { authenticated, getValueFromToken } = useTideCloak();
  const [statuses, setStatuses] = useState<Map<string, PresenceStatus>>(
    new Map(),
  );
  const [customStatuses, setCustomStatuses] = useState<Map<string, string>>(
    new Map(),
  );
  const [isDnd, setIsDnd] = useState(false);
  const [idle, setIdle] = useState(false);
  const [myCustomStatus, setMyCustomStatusState] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      return localStorage.getItem(CUSTOM_STATUS_KEY) ?? "";
    } catch {
      return "";
    }
  });

  const myUserId = (getValueFromToken("sub") as string) ?? null;

  // Derived status drives what we broadcast.
  const myStatus: PresenceStatus = useMemo(() => {
    if (isDnd) return "DND";
    if (idle) return "IDLE";
    return "ONLINE";
  }, [isDnd, idle]);

  // ── Idle detection: visibilitychange + activity timer ─────────────────────
  useEffect(() => {
    if (!authenticated) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const reset = () => {
      setIdle(false);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), IDLE_AFTER_MS);
    };
    const onVisibility = () => {
      if (document.hidden) setIdle(true);
      else reset();
    };
    const events: (keyof DocumentEventMap)[] = [
      "mousemove",
      "keydown",
      "click",
      "scroll",
      "touchstart",
    ];
    for (const e of events) document.addEventListener(e, reset, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    reset();
    return () => {
      for (const e of events) document.removeEventListener(e, reset);
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer) clearTimeout(timer);
    };
  }, [authenticated]);

  // ── Supabase Realtime presence ────────────────────────────────────────────
  const channelRef = useRef<ReturnType<ReturnType<typeof getSupabase>["channel"]> | null>(null);
  useEffect(() => {
    if (!authenticated || !myUserId) return;
    const supabase = getSupabase();
    const ch = supabase.channel("presence:global", {
      config: { presence: { key: myUserId } },
    });
    channelRef.current = ch;

    const refreshStatuses = () => {
      const stateMap = ch.presenceState() as Record<
        string,
        Array<{ status?: PresenceStatus; custom?: string }>
      >;
      const next = new Map<string, PresenceStatus>();
      const customNext = new Map<string, string>();
      for (const [userId, metas] of Object.entries(stateMap)) {
        // Take the latest meta in case the same user has multiple tabs.
        const last = metas[metas.length - 1];
        next.set(userId, (last?.status ?? "ONLINE") as PresenceStatus);
        if (last?.custom) customNext.set(userId, last.custom);
      }
      setStatuses(next);
      setCustomStatuses(customNext);
    };

    ch.on("presence", { event: "sync" }, refreshStatuses)
      .on("presence", { event: "join" }, refreshStatuses)
      .on("presence", { event: "leave" }, refreshStatuses)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          try {
            await ch.track({ status: myStatus, custom: myCustomStatus });
          } catch {}
        }
      });

    return () => {
      try {
        supabase.removeChannel(ch);
      } catch {}
      channelRef.current = null;
    };
    // myStatus intentionally NOT a dep — we re-broadcast via the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, myUserId]);

  // Re-broadcast our status whenever it changes locally.
  useEffect(() => {
    const ch = channelRef.current;
    if (!ch) return;
    void ch.track({ status: myStatus, custom: myCustomStatus }).catch(() => {});
  }, [myStatus, myCustomStatus]);

  const setDnd = useCallback((on: boolean) => setIsDnd(on), []);
  const setCustomStatus = useCallback((text: string) => {
    const trimmed = text.slice(0, MAX_CUSTOM_STATUS);
    setMyCustomStatusState(trimmed);
    try {
      if (trimmed) localStorage.setItem(CUSTOM_STATUS_KEY, trimmed);
      else localStorage.removeItem(CUSTOM_STATUS_KEY);
    } catch {}
  }, []);

  const value: PresenceContextValue = useMemo(
    () => ({
      statuses,
      customStatuses,
      myStatus,
      myCustomStatus,
      setDnd,
      setCustomStatus,
      isDnd,
    }),
    [statuses, customStatuses, myStatus, myCustomStatus, setDnd, setCustomStatus, isDnd],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePresence(): PresenceContextValue {
  const v = useContext(Ctx);
  if (!v) {
    // Render-time fall-through: outside provider, return a stable "unknown"
    // shape so consumer components don't have to null-check.
    return {
      statuses: new Map(),
      customStatuses: new Map(),
      myStatus: "OFFLINE",
      myCustomStatus: "",
      setDnd: () => {},
      setCustomStatus: () => {},
      isDnd: false,
    };
  }
  return v;
}

/** Resolve the live status for a userId, falling back to OFFLINE if the user
 *  isn't currently broadcasting (i.e. has no open tab). */
export function useUserStatus(userId: string | null | undefined): PresenceStatus {
  const { statuses } = usePresence();
  if (!userId) return "OFFLINE";
  return statuses.get(userId) ?? "OFFLINE";
}
