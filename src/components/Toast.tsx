"use client";

/**
 * Tiny toast layer. Mounted once at AppShell; anywhere in the app can call
 *
 *     showToast("Copied!");
 *
 * to flash a small bottom-right notification. Toasts auto-dismiss after a
 * few seconds; up to three are stacked at once.
 */
import { useEffect, useState } from "react";
import { Check, AlertCircle, Info } from "lucide-react";

interface ToastEntry {
  id: number;
  message: string;
  kind: "success" | "error" | "info";
}

let nextId = 1;
const listeners: Array<(t: ToastEntry) => void> = [];

export function showToast(message: string, kind: "success" | "error" | "info" = "info") {
  const entry: ToastEntry = { id: nextId++, message, kind };
  for (const fn of listeners) fn(entry);
}

export function ToastHost() {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  useEffect(() => {
    const onShow = (t: ToastEntry) => {
      setToasts((cur) => [...cur, t].slice(-3));
      window.setTimeout(() => {
        setToasts((cur) => cur.filter((x) => x.id !== t.id));
      }, 2400);
    };
    listeners.push(onShow);
    return () => {
      const idx = listeners.indexOf(onShow);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }, []);

  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-[120] flex flex-col gap-2">
      {toasts.map((t) => {
        const Icon =
          t.kind === "success" ? Check : t.kind === "error" ? AlertCircle : Info;
        const color =
          t.kind === "success"
            ? "text-green-300"
            : t.kind === "error"
              ? "text-red-300"
              : "text-white";
        return (
          <div
            key={t.id}
            className="pointer-events-auto flex items-center gap-2 rounded-md bg-surface-100 px-3 py-2 text-sm shadow-2xl ring-1 ring-black/40"
          >
            <Icon className={`h-4 w-4 ${color}`} />
            <span className={color}>{t.message}</span>
          </div>
        );
      })}
    </div>
  );
}
