"use client";

/**
 * Browser-side Supabase client.
 *
 * Used purely as a Realtime transport — broadcast channels for messages,
 * typing, and voice signaling, plus presence for the per-channel voice
 * roster. We do NOT use Supabase Auth / Postgres-from-the-client; the API
 * routes still run against Prisma server-side.
 *
 * The anon key is safe to ship to the browser (it's a "publishable" key by
 * design). Channel IDs are server-issued cuids — random and non-enumerable —
 * so casual subscription is impractical. All payloads transiting Realtime
 * are E2EE: messages are AES-GCM ciphertext, voice SDP is HMAC-signed under
 * the server epoch key. The Supabase server cannot read either.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
// Supabase's new key naming uses `PUBLISHABLE_KEY` (sb_publishable_*); the
// older "anon" key naming still works if a project predates the rename.
// Accept either so the same code works against new and old projects.
const PUBLIC_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";

let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!cached) {
    if (!URL || !PUBLIC_KEY) {
      throw new Error(
        "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      );
    }
    cached = createClient(URL, PUBLIC_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 20 } },
    });
  }
  return cached;
}
