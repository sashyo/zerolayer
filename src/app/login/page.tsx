"use client";

import { useEffect } from "react";
import { useTideCloak } from "@tidecloak/nextjs";
import { Shield, Zap, Lock } from "lucide-react";

const RETURN_URL_KEY = "zl:returnUrl";

/** Stash the `?returnUrl=` query param so we can navigate back to it after the
 *  OIDC roundtrip completes. We use sessionStorage rather than relying on
 *  whatever the underlying SDK preserves through the redirect chain — that's
 *  been inconsistent across versions, and sessionStorage works regardless.
 *  Returns the current returnUrl (newly seen or previously stored). */
function syncReturnUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("returnUrl");
  if (fromQuery) {
    try {
      sessionStorage.setItem(RETURN_URL_KEY, fromQuery);
    } catch {}
    return fromQuery;
  }
  try {
    return sessionStorage.getItem(RETURN_URL_KEY);
  } catch {
    return null;
  }
}

export default function LoginPage() {
  const { login, authenticated, isInitializing } = useTideCloak();

  useEffect(() => {
    // Always run — captures returnUrl on first paint even before auth resolves.
    const target = syncReturnUrl();
    if (!isInitializing && authenticated) {
      const dest = target || "/channels/me";
      try {
        sessionStorage.removeItem(RETURN_URL_KEY);
      } catch {}
      window.location.href = dest;
    }
  }, [authenticated, isInitializing]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-300 px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand shadow-lg">
            <Shield className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">ZeroLayer</h1>
          <p className="mt-1 text-muted">End-to-end encrypted team chat</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl bg-surface-200 p-8 shadow-xl">
          <h2 className="mb-2 text-xl font-semibold text-white">Welcome back</h2>
          <p className="mb-6 text-sm text-muted">
            Sign in to continue. Your messages are protected by TideCloak's
            distributed cryptography — the server never sees plaintext.
          </p>

          <button
            onClick={() => {
              // Capture returnUrl synchronously at click time so it's always
              // stashed before the SDK navigates away.
              syncReturnUrl();
              login();
            }}
            className="w-full rounded-lg bg-brand px-4 py-3 font-semibold text-white
                       transition-colors hover:bg-brand-hover focus:outline-none focus:ring-2
                       focus:ring-brand focus:ring-offset-2 focus:ring-offset-surface-200"
          >
            Sign in with TideCloak
          </button>

          <div className="mt-6 grid grid-cols-3 gap-3 border-t border-surface-400 pt-6">
            {[
              { icon: Lock, label: "E2EE", desc: "Messages encrypted in browser" },
              { icon: Shield, label: "Zero-Trust", desc: "Server never decrypts" },
              { icon: Zap, label: "Forseti", desc: "Policy-governed access" },
            ].map(({ icon: Icon, label, desc }) => (
              <div key={label} className="text-center">
                <div className="mx-auto mb-1 flex h-8 w-8 items-center justify-center rounded-lg bg-brand/10">
                  <Icon className="h-4 w-4 text-brand" />
                </div>
                <p className="text-xs font-medium text-white">{label}</p>
                <p className="text-xs text-muted">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
