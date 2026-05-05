"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTideCloak } from "@tidecloak/nextjs";
import { RealtimeProvider } from "@/components/providers/RealtimeProvider";
import { KeysProvider } from "@/components/providers/KeysProvider";
import { PresenceProvider } from "@/components/providers/PresenceProvider";
import { UnreadProvider } from "@/components/providers/UnreadProvider";
import { AppShell } from "@/components/layout/AppShell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { authenticated, isInitializing, token } = useTideCloak();
  const router = useRouter();
  const synced = useRef(false);

  // Guard — redirect unauthenticated visitors
  useEffect(() => {
    if (!isInitializing && !authenticated) router.replace("/login");
  }, [isInitializing, authenticated, router]);

  // Sync user profile on first load
  useEffect(() => {
    if (!authenticated || !token || synced.current) return;
    synced.current = true;
    fetch("/api/users/me", {
      headers: { Authorization: `Bearer ${token}` },
    }).catch(console.warn);
  }, [authenticated, token]);

  if (isInitializing) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-300">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand border-t-transparent" />
      </div>
    );
  }

  if (!authenticated) return null;

  return (
    <RealtimeProvider>
      <KeysProvider>
        <PresenceProvider>
          <UnreadProvider>
            <AppShell>{children}</AppShell>
          </UnreadProvider>
        </PresenceProvider>
      </KeysProvider>
    </RealtimeProvider>
  );
}
