/**
 * PATCH /api/channels/[channelId] — update channel metadata.
 *
 * Currently supports renaming and editing the topic (description). Restricted
 * to the parent server's owner. DMs (no server) cannot be renamed via this
 * endpoint.
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth, jsonError, ApiError } from "@/lib/auth-server";

const PatchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1024).nullable().optional(),
  categoryId: z.string().nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> },
) {
  try {
    const me = await requireAuth(req);
    const { channelId } = await params;
    const body = await req.json();
    const data = PatchSchema.parse(body);

    const channel = await db.channel.findUnique({
      where: { id: channelId },
      select: {
        id: true,
        serverId: true,
        server: { select: { ownerId: true } },
      },
    });
    if (!channel) throw new ApiError("Channel not found", 404);
    if (!channel.serverId)
      throw new ApiError("DM channels can't be renamed", 400);
    if (channel.server?.ownerId !== me.sub)
      throw new ApiError("Only the server owner can edit channels", 403);

    const updated = await db.channel.update({
      where: { id: channelId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.categoryId !== undefined ? { categoryId: data.categoryId } : {}),
      },
    });

    return Response.json({
      channel: {
        id: updated.id,
        name: updated.name,
        description: updated.description,
        categoryId: updated.categoryId,
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}
