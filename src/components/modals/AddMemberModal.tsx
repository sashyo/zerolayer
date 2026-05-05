"use client";

/**
 * AddMemberModal — keypair-mode.
 *
 *   1. Owner enters a username and clicks Add.
 *   2. POST /members/add  → backend creates the membership rows and returns
 *      the target user's public key.
 *   3. Owner's browser unwraps its own copy of the current epoch key.
 *   4. Wraps that epoch for the target's public key (ECDH-ES).
 *   5. POSTs the wrap to /api/servers/[id]/keys.
 *
 * No enclave popup, no IGA flow. The cryptographic gate is the per-recipient
 * wrap: nobody outside the wrap list can decrypt messages.
 */
import { useState } from "react";
import { useTideCloak } from "@tidecloak/nextjs";
import {
  X,
  Loader2,
  CheckCircle,
  AlertCircle,
  UserPlus,
} from "lucide-react";
import { useKeys } from "@/components/providers/KeysProvider";
import {
  wrapEpochForRecipient,
  unwrapEpochWithPrivate,
} from "@/lib/crypto";

type Step = "idle" | "creating" | "wrapping-key" | "done" | "error";

interface AddMemberModalProps {
  serverId: string;
  serverName: string;
  open: boolean;
  onClose: () => void;
  onAdded?: () => void;
}

export function AddMemberModal({
  serverId,
  serverName,
  open,
  onClose,
  onAdded,
}: AddMemberModalProps) {
  const { token } = useTideCloak();
  const { getPrivateKey } = useKeys();
  const [username, setUsername] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);

  const stepLabel: Record<Step, string> = {
    idle: "Enter a username and click Add",
    creating: "Adding member to server…",
    "wrapping-key": "Wrapping server key for the new member…",
    done: "Member added",
    error: "Failed",
  };

  const reset = () => {
    setUsername("");
    setStep("idle");
    setError(null);
  };

  const handleClose = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const handleAdd = async () => {
    if (!username.trim() || !token) return;
    setError(null);
    let stage = "init";
    try {
      stage = "create-membership";
      setStep("creating");
      const addRes = await fetch(`/api/servers/${serverId}/members/add`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ username: username.trim() }),
      });
      if (!addRes.ok) {
        const body = await addRes.json().catch(() => ({}));
        throw new Error(body.error || `Server returned ${addRes.status}`);
      }
      const { target } = await addRes.json();

      stage = "load-my-wrap";
      setStep("wrapping-key");
      const myWrapsRes = await fetch(`/api/servers/${serverId}/keys`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!myWrapsRes.ok) throw new Error("Could not load own epoch wraps");
      const myKeys = await myWrapsRes.json();
      const currentVer: number = myKeys.currentKeyVersion;
      const myCurrent = (myKeys.wraps ?? []).find(
        (w: any) => w.version === currentVer,
      );
      if (!myCurrent) throw new Error("You have no wrap for the current epoch");

      stage = "unwrap-epoch";
      const myPriv = await getPrivateKey();
      const epoch = await unwrapEpochWithPrivate(myPriv, {
        ephemeralPubB64: myCurrent.ephemeralPub,
        ivB64: myCurrent.iv,
        wrappedKeyB64: myCurrent.wrappedKey,
      });

      stage = "wrap-for-target";
      const wrap = await wrapEpochForRecipient(epoch, target.publicKey);

      stage = "store-wrap";
      const postRes = await fetch(`/api/servers/${serverId}/keys`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          userId: target.id,
          version: currentVer,
          ephemeralPub: wrap.ephemeralPubB64,
          iv: wrap.ivB64,
          wrappedKey: wrap.wrappedKeyB64,
        }),
      });
      if (!postRes.ok) {
        const body = await postRes.text().catch(() => "");
        throw new Error(`epoch wrap POST ${postRes.status}: ${body}`);
      }

      setStep("done");
      onAdded?.();
      await new Promise((r) => setTimeout(r, 700));
      reset();
      onClose();
    } catch (err: any) {
      console.error(`[AddMember] failed at stage=${stage}`, err);
      setStep("error");
      const detail =
        err?.message ||
        (typeof err === "string" ? err : null) ||
        (err && JSON.stringify(err)) ||
        "Unknown error";
      setError(`[${stage}] ${detail}`);
    }
  };

  const busy = ["creating", "wrapping-key"].includes(step);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-surface-200 shadow-2xl">
        <div className="flex items-center justify-between p-6 pb-2">
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-brand" />
            <div>
              <h2 className="text-xl font-bold text-white">Add Member</h2>
              <p className="mt-0.5 text-xs text-muted">{serverName}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={busy}
            className="rounded p-1 text-muted hover:text-white disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 pt-2">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted">
            Username
          </label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && handleAdd()}
            placeholder="alice"
            disabled={busy || step === "done"}
            className="w-full rounded-lg bg-surface-100 px-3 py-2.5 text-sm text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
            autoFocus
          />

          <div className="mt-4 rounded-lg bg-surface-100 p-3">
            <div className="flex items-center gap-2">
              {step === "done" ? (
                <CheckCircle className="h-4 w-4 text-green-400" />
              ) : step === "error" ? (
                <AlertCircle className="h-4 w-4 text-red-400" />
              ) : busy ? (
                <Loader2 className="h-4 w-4 animate-spin text-brand" />
              ) : (
                <UserPlus className="h-4 w-4 text-muted" />
              )}
              <span
                className={
                  step === "done"
                    ? "text-sm text-green-400"
                    : step === "error"
                      ? "text-sm text-red-400"
                      : "text-sm text-white"
                }
              >
                {stepLabel[step]}
              </span>
            </div>
            {error && (
              <p className="mt-2 break-words text-xs text-red-400">{error}</p>
            )}
          </div>

          <div className="mt-6 flex gap-3">
            <button
              onClick={handleClose}
              disabled={busy}
              className="flex-1 rounded-lg border border-surface-400 py-2.5 text-sm text-muted hover:border-brand/40 hover:text-white disabled:opacity-50"
            >
              {step === "done" ? "Close" : "Cancel"}
            </button>
            <button
              onClick={handleAdd}
              disabled={!username.trim() || busy || step === "done"}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand py-2.5 text-sm font-semibold hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-brand/40"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
