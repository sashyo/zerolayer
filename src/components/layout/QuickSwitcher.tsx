"use client";

/**
 * QuickSwitcher — Discord-style Ctrl/Cmd+K omnibox.
 *
 * Builds a flat search index of every text/voice channel across all the
 * user's servers plus the open DMs (loaded from /api/dm) and lets you jump
 * to any of them with prefix matching on name. Arrow keys move the highlight,
 * Enter / click navigates and closes.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTideCloak } from "@tidecloak/nextjs";
import { Hash, Volume2, MessageSquare, Search } from "lucide-react";
import type { SerializedServer } from "@/types";

interface QuickSwitcherProps {
  servers: SerializedServer[];
  onClose: () => void;
}

interface Entry {
  key: string;
  label: string;
  hint: string;
  href: string;
  kind: "TEXT" | "VOICE" | "DM";
}

interface DmEntry {
  id: string;
  participants: Array<{
    id: string;
    username: string;
    displayName: string;
  }>;
}

export function QuickSwitcher({ servers, onClose }: QuickSwitcherProps) {
  const router = useRouter();
  const { token, getValueFromToken } = useTideCloak();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [dms, setDms] = useState<DmEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const mySub = (getValueFromToken("sub") as string) ?? "";

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch("/api/dm", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setDms(d.dms ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token]);

  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    for (const s of servers) {
      for (const c of s.channels) {
        out.push({
          key: `ch:${c.id}`,
          label: c.name,
          hint: s.name,
          href: `/channels/${s.id}/${c.id}`,
          kind: c.type === "VOICE" ? "VOICE" : "TEXT",
        });
      }
    }
    for (const d of dms) {
      const other = d.participants.find((p) => p.id !== mySub);
      if (!other) continue;
      const name = other.displayName || other.username;
      out.push({
        key: `dm:${d.id}`,
        label: name,
        hint: "Direct Message",
        href: `/channels/me/${d.id}`,
        kind: "DM",
      });
    }
    return out;
  }, [servers, dms, mySub]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries.slice(0, 30);
    const scored: Array<{ e: Entry; score: number }> = [];
    for (const e of entries) {
      const label = e.label.toLowerCase();
      if (label === q) scored.push({ e, score: 0 });
      else if (label.startsWith(q)) scored.push({ e, score: 1 });
      else if (label.includes(q)) scored.push({ e, score: 2 });
      else if (e.hint.toLowerCase().includes(q)) scored.push({ e, score: 3 });
    }
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, 30).map((x) => x.e);
  }, [entries, query]);

  useEffect(() => {
    if (highlight >= filtered.length) setHighlight(0);
  }, [filtered.length, highlight]);

  const go = (entry: Entry) => {
    onClose();
    router.push(entry.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = filtered[highlight];
      if (target) go(target);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/50 pt-24"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[34rem] max-w-[90vw] overflow-hidden rounded-lg bg-surface-200 shadow-2xl ring-1 ring-black/40"
      >
        <div className="flex items-center gap-2 border-b border-surface-100/50 px-3">
          <Search className="h-4 w-4 text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Where would you like to go?"
            className="flex-1 bg-transparent py-3 text-sm text-white placeholder-muted focus:outline-none"
          />
          <kbd className="rounded bg-surface-100 px-1.5 py-0.5 font-mono text-[10px] text-muted">
            Esc
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted">
              No matches.
            </p>
          ) : (
            filtered.map((e, i) => (
              <button
                key={e.key}
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => go(e)}
                className={
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm " +
                  (i === highlight
                    ? "bg-brand/20 text-white"
                    : "text-muted hover:bg-surface-100/60 hover:text-white")
                }
              >
                <Icon kind={e.kind} />
                <span className="font-medium text-white">{e.label}</span>
                <span className="ml-auto truncate text-xs text-muted">
                  {e.hint}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function Icon({ kind }: { kind: Entry["kind"] }) {
  const Cmp = kind === "VOICE" ? Volume2 : kind === "DM" ? MessageSquare : Hash;
  return <Cmp className="h-4 w-4 shrink-0 text-muted" />;
}
