/**
 * DM channel creation and listing.
 * A DM is a Channel with type=DM and no serverId.
 * The same Forseti policy model applies — each DM channel gets its own role
 * so only the two participants can decrypt messages.
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth, jsonError, ApiError } from "@/lib/auth-server";
// (DM E2EE in keypair-mode is out of scope here — no TideCloak admin work)

const OpenDMSchema = z.object({
  // 1:1 DM
  targetUserId: z.string().min(1).optional(),
  // Group DM (3-10 members including self)
  targetUserIds: z.array(z.string().min(1)).min(2).max(9).optional(),
  // Optional name for group DMs
  name: z.string().max(60).optional(),
});

// GET /api/dm — list DM channels for the caller
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req);

    const memberships = await db.channelMember.findMany({
      where: {
        userId: user.sub,
        channel: { serverId: null, type: { in: ["DM", "GROUP_DM"] } },
      },
      include: {
        channel: {
          include: {
            members: { include: { user: true } },
            messages: {
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
      },
      orderBy: { joinedAt: "desc" },
    });

    const dms = memberships.map(({ channel }) => ({
      id: channel.id,
      type: channel.type,
      name: channel.name,
      participants: channel.members.map((m) => ({
        id: m.user.id,
        username: m.user.username,
        displayName: m.user.displayName,
        avatarUrl: m.user.avatarUrl,
        status: m.user.status,
      })),
      lastMessage: channel.messages[0]
        ? { id: channel.messages[0].id, createdAt: channel.messages[0].createdAt }
        : null,
    }));

    return Response.json({ dms });
  } catch (err) {
    return jsonError(err);
  }
}

// POST /api/dm — open/get-existing 1:1 DM, OR create a group DM.
// Body shapes:
//   { targetUserId: "<id>" }              → 1:1 (existing-or-new)
//   { targetUserIds: ["<a>", "<b>", ...], name?: string } → group DM (always new)
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req);
    const body = await req.json();
    const data = OpenDMSchema.parse(body);

    // ── Group DM ──────────────────────────────────────────────────────────
    if (data.targetUserIds && data.targetUserIds.length > 0) {
      const ids = Array.from(new Set(data.targetUserIds.filter((id) => id !== user.sub)));
      if (ids.length < 2) {
        throw new ApiError("Group DM needs at least 2 other people", 400);
      }
      const found = await db.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, displayName: true, username: true },
      });
      if (found.length !== ids.length) {
        throw new ApiError("One or more users not found", 404);
      }
      // Default name = comma list of display names if none supplied.
      const fallbackName =
        data.name?.trim() ||
        found.map((u) => u.displayName || u.username).join(", ").slice(0, 60);

      const channel = await db.channel.create({
        data: {
          name: fallbackName,
          type: "GROUP_DM",
          isPrivate: true,
          members: {
            create: [{ userId: user.sub }, ...ids.map((id) => ({ userId: id }))],
          },
        },
      });
      return Response.json(
        { channelId: channel.id, existing: false, type: "GROUP_DM" },
        { status: 201 },
      );
    }

    // ── 1:1 DM (legacy default path) ──────────────────────────────────────
    const targetUserId = data.targetUserId;
    if (!targetUserId) throw new ApiError("targetUserId required", 400);
    if (targetUserId === user.sub) throw new ApiError("Cannot DM yourself", 400);

    const targetUser = await db.user.findUnique({ where: { id: targetUserId } });
    if (!targetUser) throw new ApiError("User not found", 404);

    const existing = await db.channel.findFirst({
      where: {
        type: "DM",
        serverId: null,
        AND: [
          { members: { some: { userId: user.sub } } },
          { members: { some: { userId: targetUserId } } },
          { members: { every: { userId: { in: [user.sub, targetUserId] } } } },
        ],
      },
      include: { members: true },
    });

    if (existing && existing.members.length === 2) {
      return Response.json({ channelId: existing.id, existing: true });
    }

    const channel = await db.channel.create({
      data: {
        name: `dm-${user.sub.slice(-4)}-${targetUserId.slice(-4)}`,
        type: "DM",
        isPrivate: true,
        members: {
          create: [{ userId: user.sub }, { userId: targetUserId }],
        },
      },
    });

    return Response.json({ channelId: channel.id, existing: false }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
