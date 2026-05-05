"use client";

import { TideCloakProvider as TC } from "@tidecloak/nextjs";
import adapterConfig from "../../../public/adapter.json";

export function TideCloakProvider({ children }: { children: React.ReactNode }) {
  return <TC config={adapterConfig}>{children}</TC>;
}
