"use client";

/**
 * KeysProvider — single source of truth for the caller's ECDH keypair.
 *
 * Wraps useMyKeys so multiple consumers (CreateServerModal, AddMemberModal,
 * useServerKey, …) share the same bootstrap and private-key cache. Without
 * this, each component would race to generate its own keypair on first
 * login.
 */
import { createContext, useContext, type ReactNode } from "react";
import { useMyKeys } from "@/hooks/useMyKeys";

type KeysContext = ReturnType<typeof useMyKeys>;

const Ctx = createContext<KeysContext | null>(null);

export function KeysProvider({ children }: { children: ReactNode }) {
  const value = useMyKeys();
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useKeys(): KeysContext {
  const v = useContext(Ctx);
  if (!v) throw new Error("useKeys must be used inside <KeysProvider>");
  return v;
}
