import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth, jsonError, ApiError } from "@/lib/auth-server";
// (no TideCloak admin work in keypair-mode — server membership is gated by epoch wraps)

const CreateServerSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
});

// GET /api/servers — list servers the caller is a member of
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req);

    const memberships = await db.serverMember.findMany({
      where: { userId: user.sub },
      include: {
        server: {
          include: {
            channels: { orderBy: { position: "asc" } },
            categories: { orderBy: { position: "asc" } },
            roles: { orderBy: { position: "asc" } },
            members: {
              include: { user: true, role: true },
            },
            _count: { select: { members: true } },
          },
        },
      },
    });

    const servers = memberships.map((m) => serializeServer(m.server, user.sub));
    return Response.json({ servers });
  } catch (err) {
    return jsonError(err);
  }
}

// POST /api/servers — create a new server + default channel
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req);
    const body = await req.json();
    const data = CreateServerSchema.parse(body);

    // Upsert the caller into the users table (first-login sync)
    await db.user.upsert({
      where: { id: user.sub },
      create: {
        id: user.sub,
        username: user.preferred_username,
        displayName: user.name || user.preferred_username,
        avatarUrl: user.picture ?? null,
        status: "ONLINE",
      },
      update: { status: "ONLINE" },
    });

    const server = await db.$transaction(async (tx) => {
      const srv = await tx.server.create({
        data: {
          name: data.name,
          description: data.description ?? null,
          ownerId: user.sub,
        },
      });

      // Default "@everyone" role
      const defaultRole = await tx.role.create({
        data: {
          serverId: srv.id,
          name: "@everyone",
          isDefault: true,
          permissions: BigInt(0),
        },
      });

      // Add owner as member
      await tx.serverMember.create({
        data: { serverId: srv.id, userId: user.sub, roleId: defaultRole.id },
      });

      // Default #general text channel
      const generalChannel = await tx.channel.create({
        data: {
          serverId: srv.id,
          name: "general",
          type: "TEXT",
          position: 0,
        },
      });

      // Add owner to the channel
      await tx.channelMember.create({
        data: { channelId: generalChannel.id, userId: user.sub },
      });

      return tx.server.findUniqueOrThrow({
        where: { id: srv.id },
        include: {
          channels: { orderBy: { position: "asc" } },
          categories: { orderBy: { position: "asc" } },
          roles: { orderBy: { position: "asc" } },
          members: { include: { user: true, role: true } },
        },
      });
    });

    return Response.json({ server: serializeServer(server, user.sub) }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}

// ── Serializer ────────────────────────────────────────────────────────────────

function serializeServer(server: any, viewerUserId: string) {
  return {
    id: server.id,
    name: server.name,
    description: server.description,
    iconUrl: server.iconUrl,
    inviteCode: server.inviteCode,
    ownerId: server.ownerId,
    srvAdminRoleId: server.srvAdminRoleId ?? null,
    srvMemberRoleId: server.srvMemberRoleId ?? null,
    approvalPolicySignedAt: server.approvalPolicySignedAt
      ? server.approvalPolicySignedAt.toISOString()
      : null,
    channels: server.channels.map((ch: any) => ({
      id: ch.id,
      serverId: ch.serverId,
      name: ch.name,
      description: ch.description,
      type: ch.type,
      isPrivate: ch.isPrivate,
      position: ch.position,
      categoryId: ch.categoryId ?? null,
    })),
    categories: (server.categories ?? []).map((c: any) => ({
      id: c.id,
      serverId: c.serverId,
      name: c.name,
      position: c.position,
    })),
    roles: server.roles.map((r: any) => ({
      id: r.id,
      serverId: r.serverId,
      name: r.name,
      color: r.color,
      permissions: r.permissions.toString(),
      position: r.position,
      isDefault: r.isDefault,
    })),
    members: server.members.map((m: any) => ({
      userId: m.userId,
      serverId: m.serverId,
      roleId: m.roleId,
      nickname: m.nickname,
      user: {
        id: m.user.id,
        username: m.user.username,
        displayName: m.user.displayName,
        avatarUrl: m.user.avatarUrl,
        accentColor: m.user.accentColor ?? null,
        status: m.user.status,
      },
      role: m.role
        ? {
            id: m.role.id,
            name: m.role.name,
            color: m.role.color,
            permissions: m.role.permissions.toString(),
          }
        : null,
    })),
  };
}
