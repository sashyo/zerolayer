"use client";

import { useState } from "react";
import { X, Copy, Check, Link as LinkIcon } from "lucide-react";

interface InviteModalProps {
  serverName: string;
  inviteCode: string;
  open: boolean;
  onClose: () => void;
}

export function InviteModal({ serverName, inviteCode, open, onClose }: InviteModalProps) {
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const inviteUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/invite/${inviteCode}`
      : `/invite/${inviteCode}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API can be blocked — fall back to selection
      const ta = document.createElement("textarea");
      ta.value = inviteUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-surface-200 shadow-2xl">
        <div className="flex items-center justify-between p-6 pb-2">
          <div className="flex items-center gap-2">
            <LinkIcon className="h-5 w-5 text-brand" />
            <h2 className="text-xl font-bold text-white">Invite to {serverName}</h2>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 pt-2">
          <p className="mb-3 text-sm text-muted">
            Share this link with anyone you want to invite.
          </p>

          <div className="flex items-center gap-2 rounded-lg bg-surface-100 px-3 py-2.5">
            <input
              readOnly
              value={inviteUrl}
              className="flex-1 truncate bg-transparent text-sm text-white focus:outline-none"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              onClick={handleCopy}
              className="flex shrink-0 items-center gap-1 rounded bg-brand px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-hover"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3" /> Copied
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" /> Copy
                </>
              )}
            </button>
          </div>

          <p className="mt-3 text-xs text-muted/70">
            Or share the code:{" "}
            <span className="font-mono text-white">{inviteCode}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
