"use client";

import { useState } from "react";
import { useTideCloak } from "@tidecloak/nextjs";
import { X, LogOut, KeyRound } from "lucide-react";
import { useKeys } from "@/components/providers/KeysProvider";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { getValueFromToken, logout } = useTideCloak();
  const { resetKeys } = useKeys();
  const [confirmReset, setConfirmReset] = useState(false);

  const display = (getValueFromToken("preferred_username") as string) ?? "User";
  const email = (getValueFromToken("email") as string) ?? "";

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl bg-surface-200 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-4">
          <h2 className="text-xl font-bold text-white">User Settings</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col items-center gap-3 px-6 pb-6">
          {/* Avatar */}
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand text-xl font-bold text-white">
            {display.slice(0, 2).toUpperCase()}
          </div>

          {/* Display name */}
          <p className="text-base font-semibold text-white">{display}</p>

          {/* Email */}
          {email && (
            <p className="text-xs text-muted">{email}</p>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-surface-100/20" />

        {/* Recovery + Log Out */}
        <div className="space-y-1 p-4">
          <button
            onClick={() => {
              if (confirmReset) {
                resetKeys();
              } else {
                setConfirmReset(true);
                setTimeout(() => setConfirmReset(false), 4000);
              }
            }}
            className="flex w-full items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-yellow-500/10 hover:text-yellow-300"
          >
            <KeyRound className="h-4 w-4" />
            {confirmReset
              ? "Click again to confirm — this re-bootstraps E2EE keys"
              : "Reset E2EE keys"}
          </button>
          <button
            onClick={() => {
              logout();
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-red-500/10 hover:text-red-400"
          >
            <LogOut className="h-4 w-4" />
            Log Out
          </button>
        </div>
      </div>
    </div>
  );
}
