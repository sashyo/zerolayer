/**
 * PATCH  /api/servers/[serverId]/categories/[categoryId]  — rename
 * DELETE /api/servers/[serverId]/categories/[categoryId]  — delete
 *
 * Owner-only. Deleting a category sets contained channels' categoryId to
 * null (Prisma SetNull cascade) — channels are NOT removed.
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth, jsonError, ApiError } from "@/lib/auth-server";

const PatchSchema = z.object({ name: z.string().min(1).max(60) });

async function requireOwner(serverId: string, userId: string) {
  const server = await db.server.findUnique({
    where: { id: serverId },
    select: { ownerId: true },
  });
  if (!server) throw new ApiError("Server not found", 404);
  if (server.ownerId !== userId)
    throw new ApiError("Only the server owner can edit categories", 403);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string; categoryId: string }> },
) {
  try {
    const me = await requireAuth(req);
    const { serverId, categoryId } = await params;
    await requireOwner(serverId, me.sub);
    const body = await req.json();
    const data = PatchSchema.parse(body);

    const updated = await db.channelCategory.update({
      where: { id: categoryId },
      data: { name: data.name },
    });
    return Response.json({
      category: {
        id: updated.id,
        serverId: updated.serverId,
        name: updated.name,
        position: updated.position,
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string; categoryId: string }> },
) {
  try {
    const me = await requireAuth(req);
    const { serverId, categoryId } = await params;
    await requireOwner(serverId, me.sub);
    await db.channelCategory.delete({ where: { id: categoryId } });
    return Response.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
