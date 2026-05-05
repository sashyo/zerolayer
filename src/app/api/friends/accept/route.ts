/**
 * POST /api/friends/accept    body: { id }
 *
 * Accept a PENDING friend request addressed to me. Only the receiver can
 * accept; only PENDING rows can be accepted.
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
    if (row.receiverId !== me.sub) {
      throw new ApiError("Only the recipient can accept", 403);
    }
    if (row.status === "ACCEPTED") {
      return Response.json({ ok: true, status: "ACCEPTED", id });
    }

    await db.friendship.update({
      where: { id },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });
    return Response.json({ ok: true, status: "ACCEPTED", id });
  } catch (err) {
    return jsonError(err);
  }
}
