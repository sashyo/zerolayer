/**
 * POST /api/servers/[serverId]/leave — drop the caller's membership.
 *
 * The owner can't leave (they must delete the server instead). Otherwise we
 * remove the ServerMember row + their ChannelMember rows for every channel
 * in this server. ServerKey wraps for this user are also dropped so they
 * lose decryption material when they re-join.
 */
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, jsonError, ApiError } from "@/lib/auth-server";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> },
) {
  try {
    const me = await requireAuth(req);
    const { serverId } = await params;

    const server = await db.server.findUnique({
      where: { id: serverId },
      select: { id: true, ownerId: true },
    });
    if (!server) throw new ApiError("Server not found", 404);
    if (server.ownerId === me.sub)
      throw new ApiError("Owners must delete the server, not leave it", 400);

    await db.$transaction([
      db.channelMember.deleteMany({
        where: { userId: me.sub, channel: { serverId } },
      }),
      db.serverMember.deleteMany({
        where: { userId: me.sub, serverId },
      }),
      db.serverKey.deleteMany({
        where: { userId: me.sub, serverId },
      }),
    ]);

    return Response.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
