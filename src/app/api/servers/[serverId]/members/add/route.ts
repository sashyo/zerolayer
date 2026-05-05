/**
 * POST /api/servers/[serverId]/members/add — owner-only, keypair-mode.
 *
 * In keypair-mode there is no TideCloak role gating on per-server membership;
 * "you can read this server's messages" is governed entirely by who holds an
 * unwrapped epoch key. Adding a member is therefore:
 *
 *   1. Look up the target user by username (TideCloak admin API).
 *   2. Mirror them into our DB: User row, ServerMember, ChannelMember (public
 *      channels). Idempotent.
 *   3. Return the target's id and base64 public key so the owner's browser can
 *      wrap the current epoch and POST it to /api/servers/[id]/keys.
 *
 * The cryptographic gate happens after this returns, in the owner's browser.
 *
 * Body: { username: string }
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth, jsonError, ApiError } from "@/lib/auth-server";
import { getUserByUsername } from "@/lib/tidecloak-admin";

const Schema = z.object({
  username: z.string().min(1).max(128),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> },
) {
  try {
    const me = await requireAuth(req);
    const { serverId } = await params;
    const body = await req.json();
    const { username } = Schema.parse(body);

    const server = await db.server.findUnique({
      where: { id: serverId },
      select: {
        id: true,
        ownerId: true,
        channels: { select: { id: true, isPrivate: true } },
      },
    });
    if (!server) throw new ApiError("Server not found", 404);
    if (server.ownerId !== me.sub) {
      throw new ApiError("Only the server owner can add members", 403);
    }

    // Resolve the target user's TideCloak account.
    const target = await getUserByUsername(username);
    if (!target) throw new ApiError(`User '${username}' not found`, 404);

    // Reject if they're already a member of this server.
    const existing = await db.serverMember.findUnique({
      where: { serverId_userId: { serverId, userId: target.id } },
    });
    if (existing) {
      throw new ApiError(`${username} is already a member`, 409);
    }

    // The target may not have logged into ZeroLayer yet, so they may not have
    // a User row or a published public key. Surface a useful error in that
    // case so the owner knows to ask them to log in once.
    const targetUser = await db.user.findUnique({
      where: { id: target.id },
      select: { id: true, username: true, publicKey: true },
    });
    if (!targetUser?.publicKey) {
      throw new ApiError(
        `${username} has not logged in to ZeroLayer yet — ask them to sign in once before adding`,
        409,
      );
    }

    await db.$transaction(async (tx) => {
      await tx.serverMember.create({
        data: { serverId, userId: target.id },
      });
      // Auto-add to public channels
      for (const ch of server.channels) {
        if (ch.isPrivate) continue;
        await tx.channelMember.upsert({
          where: { channelId_userId: { channelId: ch.id, userId: target.id } },
          create: { channelId: ch.id, userId: target.id },
          update: {},
        });
      }
    });

    return Response.json({
      target: {
        id: targetUser.id,
        username: targetUser.username,
        publicKey: targetUser.publicKey,
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}
