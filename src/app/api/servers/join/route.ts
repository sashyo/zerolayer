import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth, jsonError, ApiError } from "@/lib/auth-server";
// (no TideCloak admin work in keypair-mode; channel access is gated by epoch wraps)

const JoinSchema = z.object({
  inviteCode: z.string().min(4).max(64),
});

// POST /api/servers/join — redeem an invite code (works without knowing server id)
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req);
    const body = await req.json();
    const { inviteCode } = JoinSchema.parse(body);

    const server = await db.server.findFirst({
      where: { inviteCode },
      include: {
        channels: { where: { isPrivate: false } },
        roles: { where: { isDefault: true } },
      },
    });
    if (!server) throw new ApiError("Invalid invite code", 404);

    const existing = await db.serverMember.findUnique({
      where: { serverId_userId: { serverId: server.id, userId: user.sub } },
    });
    if (existing) {
      return Response.json({ serverId: server.id, alreadyMember: true });
    }

    await db.user.upsert({
      where: { id: user.sub },
      create: {
        id: user.sub,
        username: user.preferred_username,
        displayName: user.name || user.preferred_username,
        avatarUrl: user.picture ?? null,
      },
      update: {},
    });

    const defaultRole = server.roles[0];

    await db.$transaction(async (tx) => {
      await tx.serverMember.create({
        data: {
          serverId: server.id,
          userId: user.sub,
          roleId: defaultRole?.id ?? null,
        },
      });
      for (const channel of server.channels) {
        await tx.channelMember.upsert({
          where: { channelId_userId: { channelId: channel.id, userId: user.sub } },
          create: { channelId: channel.id, userId: user.sub },
          update: {},
        });
      }
    });

    // No TideCloak channel-role grants in keypair-mode. The user becomes a
    // visible member, but messages stay opaque until the owner wraps the
    // server epoch key for them via the AddMember flow (or auto-wrap on join).
    return Response.json({ serverId: server.id, alreadyMember: false });
  } catch (err) {
    return jsonError(err);
  }
}
