/**
 * POST /api/servers/[serverId]/channels — owner creates a new channel.
 * In keypair-mode, channels are pure DB rows; encryption is per-server.
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth, jsonError, ApiError } from "@/lib/auth-server";

const CreateChannelSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and hyphens"),
  type: z.enum(["TEXT", "VOICE"]).default("TEXT"),
  description: z.string().max(500).optional(),
  isPrivate: z.boolean().default(false),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> },
) {
  try {
    const user = await requireAuth(req);
    const { serverId } = await params;

    const server = await db.server.findUnique({ where: { id: serverId } });
    if (!server) throw new ApiError("Server not found", 404);
    if (server.ownerId !== user.sub) throw new ApiError("Not the server owner", 403);

    const body = await req.json();
    const data = CreateChannelSchema.parse(body);

    const maxPos = await db.channel.aggregate({
      where: { serverId },
      _max: { position: true },
    });
    const position = (maxPos._max.position ?? -1) + 1;

    const channel = await db.channel.create({
      data: {
        serverId,
        name: data.name,
        type: data.type,
        description: data.description ?? null,
        isPrivate: data.isPrivate,
        position,
      },
    });

    await db.channelMember.create({
      data: { channelId: channel.id, userId: user.sub },
    });

    return Response.json(
      {
        channel: {
          id: channel.id,
          serverId: channel.serverId,
          name: channel.name,
          type: channel.type,
          description: channel.description,
          isPrivate: channel.isPrivate,
          position: channel.position,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    return jsonError(err);
  }
}
