/**
 * POST /api/friends/decline    body: { id }
 *
 * Decline a PENDING request. Either side can decline:
 *   - Receiver declines → request is rejected.
 *   - Requester declines → request is withdrawn.
 * Both cases delete the row.
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth, jsonError, ApiError } from "@/lib/auth-server";

const Schema = z.object({ id: z.string().min(1) });

export async function POST(req: NextRequest) {
  try {
    const me = await requireAuth(req);
    const { id } = Schema.parse(await req.json());

    const row = await db.friendship.findUnique({ where: { id } });
    if (!row) throw new ApiError("Friend request not found", 404);
    if (row.requesterId !== me.sub && row.receiverId !== me.sub) {
      throw new ApiError("Not a participant of this request", 403);
    }
    if (row.status !== "PENDING") {
      throw new ApiError("Only pending requests can be declined", 409);
    }

    await db.friendship.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
