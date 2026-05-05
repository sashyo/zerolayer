/**
 * POST /api/friends/request    body: { username }
 *
 * Send a friend request to a user identified by their `username`. Idempotent:
 *
 *   - If the target already sent ME a request, accept theirs immediately
 *     (collapse parallel requests into a single ACCEPTED friendship).
 *   - If I already sent a PENDING request, return that record unchanged.
 *   - If we're already friends, return that record.
 *   - Else create a new PENDING row.
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth, jsonError, ApiError } from "@/lib/auth-server";

const Schema = z.object({
  username: z.string().min(1).max(64),
});

export async function POST(req: NextRequest) {
  try {
    const me = await requireAuth(req);
    const { username } = Schema.parse(await req.json());

    if (username === me.preferred_username) {
      throw new ApiError("You can't friend yourself", 400);
    }

    const target = await db.user.findUnique({ where: { username } });
    if (!target) throw new ApiError(`No user named '${username}'`, 404);
    if (target.id === me.sub) {
      throw new ApiError("You can't friend yourself", 400);
    }

    // Check for an existing inverse request — if they already asked us, accept.
    const inverse = await db.friendship.findUnique({
      where: {
        requesterId_receiverId: { requesterId: target.id, receiverId: me.sub },
      },
    });
    if (inverse) {
      if (inverse.status === "ACCEPTED") {
        return Response.json({ ok: true, status: "ACCEPTED", id: inverse.id });
      }
      const updated = await db.friendship.update({
        where: { id: inverse.id },
        data: { status: "ACCEPTED", acceptedAt: new Date() },
      });
      return Response.json({ ok: true, status: "ACCEPTED", id: updated.id });
    }

    // Same-direction existing — leave alone.
    const same = await db.friendship.findUnique({
      where: {
        requesterId_receiverId: { requesterId: me.sub, receiverId: target.id },
      },
    });
    if (same) {
      return Response.json({ ok: true, status: same.status, id: same.id });
    }

    const created = await db.friendship.create({
      data: {
        requesterId: me.sub,
        receiverId: target.id,
        status: "PENDING",
      },
    });
    return Response.json({ ok: true, status: "PENDING", id: created.id });
  } catch (err) {
    return jsonError(err);
  }
}
