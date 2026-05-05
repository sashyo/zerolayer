"use client";

/**
 * ForwardModal — pick a destination (channel or DM) and pre-fill that
 * destination's composer with the message's plaintext. The actual encrypt +
 * send happens in the destination channel's MessageInput on the user's own
 * action — keeps the E2EE path simple and explicit.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Hash, MessageSquare, Search, Volume2, X } from "lucide-react";
import { useTideCloak } from "@tidecloak/nextjs";
import { getServersCache, getDmsCache } from "@/lib/serversCache";

interface DestEntry {
  key: string;
  label: string;
  hint: string;
  href: string;
  kind: "TEXT" | "VOICE" | "DM" | "GROUP_DM";
}

interface ForwardModalProps {
  text: string;
  onClose: () => void;
}

export function ForwardModal({ text, onClose }: ForwardModalProps) {
  const router = useRouter();
  const { getValueFromToken } = useTideCloak();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const mySub = (getValueFromToken("sub") as string) ?? "";

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const entries = useMemo<DestEntry[]>(() => {
    const out: DestEntry[] = [];
    for (const s of getServersCache()) {
      for (const c of s.channels) {
        if (c.type === "VOICE") continue;
        out.push({
          key: `ch:${c.id}`,
          label: c.name,
          hint: s.name,
          href: `/channels/${s.id}/${c.id}`,
          kind: "TEXT",
        });
      }
    }
    for (const d of getDmsCache()) {
      const others = d.participants.filter((p) => p.id !== mySub);
      const isGroup = (d as { type?: string }).type === "GROUP_DM";
      const name = isGroup
        ? others.map((p) => p.displayName || p.username).join(", ").slice(0, 60) ||
          "Group DM"
        : others[0]?.displayName || others[0]?.username || "DM";
      out.push({
        key: `dm:${d.id}`,
        label: name,
        hint: isGroup ? "Group DM" : "Direct Message",
        href: `/channels/me/${d.id}`,
        kind: isGroup ? "GROUP_DM" : "DM",
      });
    }
    return out;
  }, [mySub]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries.slice(0, 30);
    const out: Array<{ e: DestEntry; score: number }> = [];
    for (const e of entries) {
      const l = e.label.toLowerCase();
      if (l === q) out.push({ e, score: 0 });
      else if (l.startsWith(q)) out.push({ e, score: 1 });
      else if (l.includes(q)) out.push({ e, score: 2 });
      else if (e.hint.toLowerCase().includes(q)) out.push({ e, score: 3 });
    }
    out.sort((a, b) => a.score - b.score);
    return out.slice(0, 30).map((x) => x.e);
  }, [entries, query]);

  useEffect(() => {
    if (highlight >= filtered.length) setHighlight(0);
  }, [filtered.length, highlight]);

  const send = (entry: DestEntry) => {
    onClose();
    router.push(entry.href);
    // Wait for the destination's composer to mount, then prefill it. The
    // MessageInput listens for zl:prefill-composer and sets its text.
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("zl:prefill-composer", { detail: { text } }),
      );
    }, 250);
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
      if (target) send(target);
    }
  };

  const Icon = (k: DestEntry["kind"]) =>
    k === "TEXT" ? Hash : k === "VOICE" ? Volume2 : MessageSquare;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 pt-24"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[34rem] max-w-[90vw] overflow-hidden rounded-lg bg-surface-200 shadow-2xl ring-1 ring-black/40"
      >
        <div className="flex items-center justify-between border-b border-surface-100/40 px-3">
          <div className="flex flex-1 items-center gap-2">
            <Search className="h-4 w-4 text-muted" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlight(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Forward to a channel or DM…"
              className="flex-1 bg-transparent py-3 text-sm text-white placeholder-muted focus:outline-none"
            />
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted hover:bg-surface-100 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="border-b border-white/5 px-3 py-2 text-xs text-muted">
          Forwards as your own message — you can edit before sending.
          <p className="mt-1 truncate text-[10px] opacity-80">"{text}"</p>
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted">No matches.</p>
          ) : (
            filtered.map((e, i) => {
              const Cmp = Icon(e.kind);
              return (
                <button
                  key={e.key}
                  type="button"
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => send(e)}
                  className={
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm " +
                    (i === highlight
                      ? "bg-brand/20 text-white"
                      : "text-muted hover:bg-surface-100/60 hover:text-white")
                  }
                >
                  <Cmp className="h-4 w-4 shrink-0 text-muted" />
                  <span className="font-medium text-white">{e.label}</span>
                  <span className="ml-auto truncate text-xs text-muted">
                    {e.hint}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
