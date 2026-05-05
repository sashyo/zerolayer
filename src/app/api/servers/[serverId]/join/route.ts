import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, jsonError, ApiError } from "@/lib/auth-server";
// (no TideCloak admin work in keypair-mode)

// POST /api/servers/[serverId]/join — join by invite code
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> },
) {
  try {
    const user = await requireAuth(req);
    const { inviteCode } = await req.json();

    const server = await db.server.findFirst({
      where: { inviteCode },
      include: {
        channels: { where: { isPrivate: false } },
        roles: { where: { isDefault: true } },
      },
    });
    if (!server) throw new ApiError("Invalid invite code", 404);

    // Idempotent
    const existing = await db.serverMember.findUnique({
      where: { serverId_userId: { serverId: server.id, userId: user.sub } },
    });
    if (existing) {
      return Response.json({ message: "Already a member" });
    }

    // Upsert user
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

      // Add to all public channels
      for (const channel of server.channels) {
        await tx.channelMember.upsert({
          where: { channelId_userId: { channelId: channel.id, userId: user.sub } },
          create: { channelId: channel.id, userId: user.sub },
          update: {},
        });
      }
    });

    return Response.json({ serverId: server.id });
  } catch (err) {
    return jsonError(err);
  }
}
