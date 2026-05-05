/**
 * Tiny in-memory cache for the user's servers + members list and the user's
 * DM list. AppShell / sidebars hydrate these from /api/servers and /api/dm;
 * channel pages read them synchronously on first render to skip the loading
 * flash when switching between channels of an already-loaded surface. The
 * cache is intentionally not persisted — each session re-hydrates.
 */
import type { SerializedServer } from "@/types";

let serversCache: SerializedServer[] = [];

export function setServersCache(next: SerializedServer[]) {
  serversCache = next;
}

export function getServersCache(): SerializedServer[] {
  return serversCache;
}

export interface CachedDm {
  id: string;
  participants: Array<{
    id: string;
    username: string;
    displayName: string;
  }>;
}

let dmsCache: CachedDm[] = [];

export function setDmsCache(next: CachedDm[]) {
  dmsCache = next;
}

export function getDmsCache(): CachedDm[] {
  return dmsCache;
}
