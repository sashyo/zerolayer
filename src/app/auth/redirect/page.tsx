"use client";

import { useAuthCallback } from "@tidecloak/nextjs";
import { useEffect, useState } from "react";

const RETURN_URL_KEY = "zl:returnUrl";

/** Resolve the post-auth destination. Prefer sessionStorage (set by /login)
 *  because that survives the OIDC roundtrip reliably across SDK versions;
 *  fall back to whatever the SDK hands us; finally fall back to /channels/me. */
function pickDestination(sdkReturnUrl?: string): string {
  let stashed: string | null = null;
  try {
    stashed = sessionStorage.getItem(RETURN_URL_KEY);
    if (stashed) sessionStorage.removeItem(RETURN_URL_KEY);
  } catch {}
  return stashed || sdkReturnUrl || "/channels/me";
}

function RedirectHandler() {
  const { isProcessing, isSuccess, error } = useAuthCallback({
    onSuccess: (returnUrl) => {
      window.location.assign(pickDestination(returnUrl ?? undefined));
    },
    onError: () => {
      window.location.assign("/login");
    },
    onMissingVerifierRedirectTo: "/login",
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("code") && !params.has("error")) {
      // Direct hit on /auth/redirect with no OIDC params — bounce to home or
      // a stashed returnUrl (already-authed users hitting an invite link).
      window.location.assign(pickDestination());
    }
  }, []);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-300 text-red-400">
        Authentication failed: {error.message}
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center bg-surface-300">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand border-t-transparent" />
        <p className="text-sm text-muted">
          {isProcessing ? "Completing login…" : isSuccess ? "Redirecting…" : "Loading…"}
        </p>
      </div>
    </div>
  );
}

export default function AuthRedirectPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-300">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand border-t-transparent" />
      </div>
    );
  }
  return <RedirectHandler />;
}
