/**
 * GET /api/users/[userId]/public-key
 *
 * Public-key lookup. Used by an owner's browser to wrap the server epoch key
 * for a new member during the AddMember flow, and on join to wrap for self.
 *
 * Authentication required (we don't expose public keys to the open internet).
 * Returns 404 if the target hasn't bootstrapped a keypair yet (first-login
 * race). Callers should retry or surface a "user hasn't logged in yet" error.
 */
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, jsonError, ApiError } from "@/lib/auth-server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    await requireAuth(req);
    const { userId } = await params;

    // Allow lookup by id OR username — `username` is what the AddMember UI
    // collects, and we already resolved it server-side, but supporting both
    // keeps the surface small.
    const u = await db.user.findFirst({
      where: { OR: [{ id: userId }, { username: userId }] },
      select: { id: true, username: true, publicKey: true },
    });
    if (!u || !u.publicKey) {
      // Two distinct cases share this 404 — distinguish the message so the
      // UI can surface something useful:
      //   • The user row is missing entirely → they've never logged in.
      //   • The row exists but `publicKey` is null → they're logged in but
      //     `useMyKeys` failed to bootstrap (often: IAMService not ready,
      //     `doEncrypt` rejected, or POST /api/users/me/keys 4xx'd).
      const msg = !u
        ? "User hasn't logged in yet — they need to open the app once before you can DM or invite them."
        : "User's E2EE keys haven't finished setting up yet. Ask them to refresh; if it persists they should click Retry on the yellow banner.";
      throw new ApiError(msg, 404);
    }
    return Response.json({
      userId: u.id,
      username: u.username,
      publicKey: u.publicKey,
    });
  } catch (err) {
    return jsonError(err);
  }
}
