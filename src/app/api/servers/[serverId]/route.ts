/**
 * DELETE /api/servers/[serverId] — owner-only.
 *
 *   1. Confirm the caller is the server owner.
 *   2. Delete the server row. Cascading FKs in our schema clean up channels,
 *      messages, attachments, reactions, server_members, channel_members,
 *      roles, server_keys.
 *   3. Best-effort: remove the per-server realm roles in TideCloak.
 *
 * The local DB delete is the source of truth for "this server no longer
 * exists". A TideCloak role cleanup failure is logged but does not block.
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth, jsonError, ApiError } from "@/lib/auth-server";
import { deleteServerRoles } from "@/lib/tidecloak-admin";

const PatchSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  description: z.string().max(500).nullable().optional(),
  iconUrl: z
    .string()
    .max(140_000)
    .refine(
      (s) => /^(https?:\/\/|data:image\/)/.test(s),
      "iconUrl must be http(s) or a data:image URL",
    )
    .nullable()
    .optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> },
) {
  try {
    const me = await requireAuth(req);
    const { serverId } = await params;
    const body = await req.json();
    const data = PatchSchema.parse(body);

    const server = await db.server.findUnique({
      where: { id: serverId },
      select: { id: true, ownerId: true },
    });
    if (!server) throw new ApiError("Server not found", 404);
    if (server.ownerId !== me.sub)
      throw new ApiError("Only the server owner can edit settings", 403);

    const updated = await db.server.update({
      where: { id: serverId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.iconUrl !== undefined ? { iconUrl: data.iconUrl } : {}),
      },
    });

    return Response.json({
      server: {
        id: updated.id,
        name: updated.name,
        description: updated.description,
        iconUrl: updated.iconUrl,
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(
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
    if (server.ownerId !== me.sub) {
      throw new ApiError("Only the server owner can delete this server", 403);
    }

    await db.server.delete({ where: { id: serverId } });

    // Best-effort role cleanup — failure here doesn't block the response.
    deleteServerRoles(serverId).catch((e) =>
      console.warn("[delete-server] role cleanup failed", e),
    );

    return Response.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
