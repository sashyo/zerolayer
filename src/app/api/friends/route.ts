/**
 * GET /api/friends
 *
 * Returns three buckets for the calling user:
 *   - accepted: confirmed friendships, with the other user's profile
 *   - incoming: PENDING requests addressed to me
 *   - outgoing: PENDING requests I sent that haven't been accepted yet
 *
 * Each bucket is sorted by createdAt desc.
 */
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, jsonError } from "@/lib/auth-server";

export async function GET(req: NextRequest) {
  try {
    const me = await requireAuth(req);

    // Pull every friendship that touches me; we'll partition in-memory.
    const rows = await db.friendship.findMany({
      where: {
        OR: [{ requesterId: me.sub }, { receiverId: me.sub }],
      },
      include: {
        requester: { select: profileSelect() },
        receiver: { select: profileSelect() },
      },
      orderBy: { createdAt: "desc" },
    });

    const accepted: any[] = [];
    const incoming: any[] = [];
    const outgoing: any[] = [];
    for (const r of rows) {
      const iAmRequester = r.requesterId === me.sub;
      const other = iAmRequester ? r.receiver : r.requester;
      const entry = {
        id: r.id,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        acceptedAt: r.acceptedAt?.toISOString() ?? null,
        user: other,
      };
      if (r.status === "ACCEPTED") accepted.push(entry);
      else if (iAmRequester) outgoing.push(entry);
      else incoming.push(entry);
    }

    return Response.json({ accepted, incoming, outgoing });
  } catch (err) {
    return jsonError(err);
  }
}

function profileSelect() {
  return {
    id: true,
    username: true,
    displayName: true,
    avatarUrl: true,
    accentColor: true,
    status: true,
  } as const;
}
