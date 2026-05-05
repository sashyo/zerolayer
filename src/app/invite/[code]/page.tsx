"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTideCloak } from "@tidecloak/nextjs";
import { Loader2, AlertTriangle, LogIn } from "lucide-react";

interface InvitePageProps {
  params: Promise<{ code: string }>;
}

export default function InvitePage({ params }: InvitePageProps) {
  const { code } = use(params);
  const { token, authenticated, isInitializing } = useTideCloak();
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "joining" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Wait for the SDK to finish bootstrapping before deciding what to do.
    // Without this guard we'd bounce to /login on the first render where the
    // SDK reports `authenticated=false` simply because it hasn't checked yet.
    if (isInitializing) return;

    if (authenticated === false) {
      const returnUrl = `/invite/${code}`;
      router.replace(`/login?returnUrl=${encodeURIComponent(returnUrl)}`);
      return;
    }

    if (!token) return;

    let cancelled = false;
    (async () => {
      setStatus("joining");
      try {
        const res = await fetch("/api/servers/join", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ inviteCode: code }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Server returned ${res.status}`);
        }
        const { serverId } = await res.json();
        if (cancelled) return;
        router.replace(`/channels/${serverId}`);
      } catch (err: any) {
        if (cancelled) return;
        setStatus("error");
        setError(err.message || "Failed to join");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authenticated, token, code, router, isInitializing]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-300 p-6 text-white">
      <div className="w-full max-w-sm rounded-xl bg-surface-200 p-6 text-center shadow-2xl">
        {status === "error" ? (
          <>
            <AlertTriangle className="mx-auto h-8 w-8 text-red-400" />
            <h1 className="mt-3 text-lg font-bold">Could not join server</h1>
            <p className="mt-2 text-sm text-muted">{error}</p>
            <button
              onClick={() => router.push("/channels/me")}
              className="mt-6 w-full rounded-lg bg-brand py-2.5 text-sm font-semibold hover:bg-brand-hover"
            >
              Go to ZeroLayer
            </button>
          </>
        ) : authenticated === false ? (
          <>
            <LogIn className="mx-auto h-8 w-8 text-brand" />
            <h1 className="mt-3 text-lg font-bold">Sign in to join</h1>
            <p className="mt-2 text-sm text-muted">
              You need to be signed in to redeem this invite.
            </p>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand" />
            <h1 className="mt-3 text-lg font-bold">Joining server…</h1>
            <p className="mt-2 text-sm text-muted">Code: {code}</p>
          </>
        )}
      </div>
    </div>
  );
}
