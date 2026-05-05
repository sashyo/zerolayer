"use client";

/**
 * useVoiceRoster — reactive snapshot of who's in which voice channel,
 * sourced from the singleton roster channel. Re-renders on every join/leave
 * across the realm.
 */
import { useEffect, useState } from "react";
import {
  type RosterEntry,
  getRosterSnapshot,
  subscribeRoster,
} from "@/lib/voiceRoster";

export function useVoiceRoster(): Map<string, RosterEntry[]> {
  const [snap, setSnap] = useState<Map<string, RosterEntry[]>>(() =>
    getRosterSnapshot(),
  );

  useEffect(() => {
    const unsub = subscribeRoster(() => setSnap(new Map(getRosterSnapshot())));
    setSnap(new Map(getRosterSnapshot()));
    return unsub;
  }, []);

  return snap;
}
