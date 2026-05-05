"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTideCloak } from "@tidecloak/nextjs";

export default function RootPage() {
  const { authenticated, isInitializing } = useTideCloak();
  const router = useRouter();

  useEffect(() => {
    if (isInitializing) return;
    if (authenticated) {
      router.replace("/channels/me");
    } else {
      router.replace("/login");
    }
  }, [authenticated, isInitializing, router]);

  return (
    <div className="flex h-screen items-center justify-center bg-surface-300">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand border-t-transparent" />
    </div>
  );
}
