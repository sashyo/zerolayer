/**
 * DELETE /api/dm/[channelId] — leave / close a DM or group DM.
 *
 * For 1:1 DMs we delete only the caller's ChannelMember row so the channel
 * vanishes from their sidebar; the other party still has the conversation.
 * For group DMs we do the same — leaving the group. If the channel ends up
 * with zero members it'll get pruned by the cascade later.
 */
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, jsonError, ApiError } from "@/lib/auth-server";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> },
) {
  try {
    const me = await requireAuth(req);
    const { channelId } = await params;

    const channel = await db.channel.findUnique({
      where: { id: channelId },
      select: { id: true, type: true, serverId: true },
    });
    if (!channel) throw new ApiError("DM not found", 404);
    if (channel.serverId !== null)
      throw new ApiError("Not a DM channel", 400);
    if (channel.type !== "DM" && channel.type !== "GROUP_DM")
      throw new ApiError("Not a DM channel", 400);

    await db.channelMember.deleteMany({
      where: { channelId, userId: me.sub },
    });

    return Response.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
