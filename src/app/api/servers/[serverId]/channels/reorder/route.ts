/**
 * POST /api/servers/[serverId]/channels/reorder
 *
 * Body: { positions: Array<{ id: string; position: number }> }
 * Owner-only. Persists the user-supplied ordering by writing each channel's
 * new `position`. We don't validate uniqueness — clients pass dense indices
 * (0, 1, 2, …) per channel type when they reorder.
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth, jsonError, ApiError } from "@/lib/auth-server";

const Schema = z.object({
  positions: z
    .array(
      z.object({
        id: z.string(),
        position: z.number().int().nonnegative(),
      }),
    )
    .max(200),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> },
) {
  try {
    const me = await requireAuth(req);
    const { serverId } = await params;
    const body = await req.json();
    const data = Schema.parse(body);

    const server = await db.server.findUnique({
      where: { id: serverId },
      select: { id: true, ownerId: true },
    });
    if (!server) throw new ApiError("Server not found", 404);
    if (server.ownerId !== me.sub)
      throw new ApiError("Only the server owner can reorder channels", 403);

    // updateMany would be cleaner but Prisma doesn't support it across rows
    // with different where targets; a transactional batch is fine here.
    await db.$transaction(
      data.positions.map((p) =>
        db.channel.update({
          where: { id: p.id },
          data: { position: p.position },
        }),
      ),
    );

    return Response.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
