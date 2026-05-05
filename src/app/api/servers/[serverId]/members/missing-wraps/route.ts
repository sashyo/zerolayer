/**
 * GET /api/servers/[serverId]/members/missing-wraps
 *
 * Owner-only. Returns the list of server members who:
 *   - have a published public key (i.e. they've logged in at least once and
 *     bootstrapped their ECDH keypair), AND
 *   - have NO ServerKey wrap for the server's currentKeyVersion.
 *
 * The owner's UI iterates this list, wraps the unwrapped epoch for each
 * member's public key (in-browser), and POSTs the wrap to /keys. After that
 * the member can decrypt the server epoch and join the conversation.
 *
 * This closes the gap left by the invite-redeem flow, which only adds a DB
 * membership row and doesn't (and can't) produce a wrap.
 */
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, jsonError, ApiError } from "@/lib/auth-server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> },
) {
  try {
    const me = await requireAuth(req);
    const { serverId } = await params;

    const server = await db.server.findUnique({
      where: { id: serverId },
      select: { ownerId: true, currentKeyVersion: true },
    });
    if (!server) throw new ApiError("Server not found", 404);
    if (server.ownerId !== me.sub) {
      throw new ApiError("Only the server owner can view this", 403);
    }

    const members = await db.serverMember.findMany({
      where: { serverId },
      select: {
        userId: true,
        user: {
          select: { id: true, username: true, displayName: true, publicKey: true },
        },
      },
    });

    const wrapsForVersion = await db.serverKey.findMany({
      where: { serverId, version: server.currentKeyVersion },
      select: { userId: true },
    });
    const wrappedUserIds = new Set(wrapsForVersion.map((w) => w.userId));

    const missing = members
      .filter(
        (m) =>
          m.user.publicKey != null &&        // has bootstrapped keypair
          !wrappedUserIds.has(m.userId) &&    // no wrap yet for current epoch
          m.userId !== server.ownerId,        // owner is always wrapped on creation
      )
      .map((m) => ({
        userId: m.user.id,
        username: m.user.username,
        displayName: m.user.displayName,
        publicKey: m.user.publicKey!,
      }));

    return Response.json({
      currentKeyVersion: server.currentKeyVersion,
      missing,
    });
  } catch (err) {
    return jsonError(err);
  }
}
