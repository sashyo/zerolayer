/**
 * Categories CRUD per server.
 *
 *   GET  /api/servers/[serverId]/categories      — list (any member)
 *   POST /api/servers/[serverId]/categories      — create (owner)
 *   Body: { name: string }
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth, jsonError, ApiError } from "@/lib/auth-server";

const CreateSchema = z.object({ name: z.string().min(1).max(60) });

async function ensureMember(serverId: string, userId: string) {
  const server = await db.server.findUnique({
    where: { id: serverId },
    select: { id: true, ownerId: true },
  });
  if (!server) throw new ApiError("Server not found", 404);
  const member = await db.serverMember.findFirst({
    where: { serverId, userId },
    select: { userId: true },
  });
  if (!member && server.ownerId !== userId) {
    throw new ApiError("Not a member of this server", 403);
  }
  return server;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> },
) {
  try {
    const me = await requireAuth(req);
    const { serverId } = await params;
    await ensureMember(serverId, me.sub);
    const categories = await db.channelCategory.findMany({
      where: { serverId },
      orderBy: { position: "asc" },
    });
    return Response.json({
      categories: categories.map((c) => ({
        id: c.id,
        serverId: c.serverId,
        name: c.name,
        position: c.position,
      })),
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> },
) {
  try {
    const me = await requireAuth(req);
    const { serverId } = await params;
    const server = await ensureMember(serverId, me.sub);
    if (server.ownerId !== me.sub)
      throw new ApiError("Only the server owner can create categories", 403);
    const body = await req.json();
    const data = CreateSchema.parse(body);

    const last = await db.channelCategory.findFirst({
      where: { serverId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const position = (last?.position ?? -1) + 1;

    const category = await db.channelCategory.create({
      data: { serverId, name: data.name, position },
    });
    return Response.json(
      {
        category: {
          id: category.id,
          serverId: category.serverId,
          name: category.name,
          position: category.position,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    return jsonError(err);
  }
}
