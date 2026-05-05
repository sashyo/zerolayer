"use client";

/**
 * Message context menu — Discord-style right-click menu shown above the
 * existing hover toolbar. The position is anchored to the cursor; we clamp
 * it to the viewport so it never opens off-screen.
 */
import { useEffect, useRef } from "react";
import {
  Reply,
  Pencil,
  Trash2,
  Pin,
  PinOff,
  Copy,
  Hash,
  EyeOff,
  Smile,
  User,
} from "lucide-react";

export interface MenuAction {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  danger?: boolean;
}

interface MessageContextMenuProps {
  x: number;
  y: number;
  actions: MenuAction[];
  onClose: () => void;
}

export function MessageContextMenu({
  x,
  y,
  actions,
  onClose,
}: MessageContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Clamp to viewport once we know our own dimensions.
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const maxX = window.innerWidth - r.width - 8;
    const maxY = window.innerHeight - r.height - 8;
    if (r.left > maxX) el.style.left = `${Math.max(8, maxX)}px`;
    if (r.top > maxY) el.style.top = `${Math.max(8, maxY)}px`;
  }, []);

  return (
    <div
      ref={menuRef}
      style={{ left: x, top: y }}
      className="fixed z-[70] w-52 overflow-hidden rounded-md bg-surface-100 py-1 shadow-2xl ring-1 ring-black/40"
    >
      {actions.map((a, idx) => {
        if (a.key === "_divider") {
          return <div key={`d-${idx}`} className="my-1 h-px bg-white/5" />;
        }
        const Icon = a.icon;
        return (
          <button
            key={a.key}
            type="button"
            onClick={() => {
              a.onClick();
              onClose();
            }}
            className={
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm " +
              (a.danger
                ? "text-red-400 hover:bg-red-500/10"
                : "text-white hover:bg-brand/20")
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span>{a.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// Re-export the icons callers will commonly need so they don't have to import
// them separately — keeps callsites tidy.
export const MENU_ICONS = {
  Reply,
  Pencil,
  Trash2,
  Pin,
  PinOff,
  Copy,
  Hash,
  EyeOff,
  Smile,
  User,
};
