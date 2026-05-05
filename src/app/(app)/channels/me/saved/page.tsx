"use client";

/**
 * Saved messages — a localStorage-backed bookmark list. Each entry stores
 * the plaintext at save time so the user can read it even if they later
 * lose access to the source channel (left server, key rotated, etc).
 *
 * Click an entry → navigate to the source channel and scroll to the message
 * via the existing `#msg-<id>` URL hash.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, Loader2, Trash2 } from "lucide-react";
import {
  type SavedMessage,
  getSavedMessages,
  toggleSaveMessage,
} from "@/lib/savedMessages";
import { getServersCache, getDmsCache } from "@/lib/serversCache";

function resolveHref(channelId: string): string | null {
  for (const s of getServersCache()) {
    if (s.channels.some((c) => c.id === channelId)) {
      return `/channels/${s.id}/${channelId}#msg-${channelId}`;
    }
  }
  for (const d of getDmsCache()) {
    if (d.id === channelId) return `/channels/me/${channelId}#msg-${channelId}`;
  }
  return null;
}

export default function SavedPage() {
  const router = useRouter();
  const [list, setList] = useState<SavedMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setList(getSavedMessages());
    setLoading(false);
    const refresh = () => setList(getSavedMessages());
    window.addEventListener("zl:saved-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("zl:saved-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-surface-100/20 px-4 shadow-sm">
        <Bookmark className="h-5 w-5 text-muted" />
        <span className="font-semibold text-white">Saved Messages</span>
        <span className="ml-2 rounded bg-surface-100/40 px-1.5 py-0.5 text-xs text-muted">
          {list.length}
        </span>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {list.length === 0 ? (
          <p className="text-center text-sm text-muted">
            Right-click any message and choose <em>Save Message</em> to bookmark it.
          </p>
        ) : (
          <ul className="space-y-2">
            {list.map((m) => {
              const href = resolveHref(m.channelId);
              return (
                <li
                  key={m.id}
                  className="group rounded-md bg-surface-200 p-3 ring-1 ring-surface-100/40 hover:bg-surface-200/80"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-white">
                      {m.authorName}
                    </span>
                    <span className="text-[10px] text-muted">
                      {new Date(m.savedAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-[#dcddde]">
                    {m.plaintext}
                  </p>
                  <div className="mt-2 flex items-center gap-3">
                    {href && (
                      <button
                        onClick={() => router.push(href)}
                        className="text-xs text-brand hover:underline"
                      >
                        Jump to message
                      </button>
                    )}
                    <button
                      onClick={() => {
                        toggleSaveMessage({ ...m });
                      }}
                      className="ml-auto flex items-center gap-1 text-xs text-muted hover:text-red-300"
                    >
                      <Trash2 className="h-3 w-3" />
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
