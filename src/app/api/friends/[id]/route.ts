/**
 * DELETE /api/friends/[id] — remove an ACCEPTED friendship from either side.
 */
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, jsonError, ApiError } from "@/lib/auth-server";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const me = await requireAuth(req);
    const { id } = await params;
    const row = await db.friendship.findUnique({ where: { id } });
    if (!row) throw new ApiError("Friendship not found", 404);
    if (row.requesterId !== me.sub && row.receiverId !== me.sub) {
      throw new ApiError("Not a participant", 403);
    }
    await db.friendship.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
