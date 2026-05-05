/**
 * Server epoch-key wraps.
 *
 *   GET  /api/servers/[serverId]/keys?userId=<sub>?
 *      Returns wraps for the caller (or for any user if the caller is the
 *      owner — needed when the owner is rotating the epoch and pre-loading
 *      historical wraps, but in the common path you call without ?userId).
 *
 *   POST /api/servers/[serverId]/keys
 *      Body: {
 *        userId,         // recipient
 *        version,        // epoch version this wrap is for
 *        ephemeralPub,   // base64 ECDH ephemeral public key
 *        iv,             // base64 12-byte AES-GCM IV
 *        wrappedKey,     // base64 ciphertext of the raw 32-byte epoch
 *        bumpToCurrent?  // if true, set Server.currentKeyVersion = version
 *      }
 *
 *      Authorisation: only the server owner can write wraps. (When a member
 *      joins via invite they don't have the epoch — the owner produces all
 *      wraps for the server.)
 *
 *      The very first POST after server creation is the owner wrapping for
 *      themself; subsequent POSTs are wraps for new members or rotation
 *      passes.
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth, jsonError, ApiError } from "@/lib/auth-server";

const PostSchema = z.object({
  userId: z.string().min(1),
  version: z.number().int().positive(),
  ephemeralPub: z.string().min(20),
  iv: z.string().min(8).max(32),
  wrappedKey: z.string().min(20),
  bumpToCurrent: z.boolean().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> },
) {
  try {
    const me = await requireAuth(req);
    const { serverId } = await params;

    const url = new URL(req.url);
    const targetUserId = url.searchParams.get("userId") ?? me.sub;

    if (targetUserId !== me.sub) {
      const server = await db.server.findUnique({
        where: { id: serverId },
        select: { ownerId: true },
      });
      if (!server) throw new ApiError("Server not found", 404);
      if (server.ownerId !== me.sub) {
        throw new ApiError("Only the owner may fetch other users' wraps", 403);
      }
    }

    const wraps = await db.serverKey.findMany({
      where: { serverId, userId: targetUserId },
      orderBy: { version: "asc" },
    });

    const server = await db.server.findUnique({
      where: { id: serverId },
      select: { currentKeyVersion: true },
    });

    return Response.json({
      currentKeyVersion: server?.currentKeyVersion ?? 1,
      wraps: wraps.map((w) => ({
        version: w.version,
        ephemeralPub: w.ephemeralPub,
        iv: w.iv,
        wrappedKey: w.wrappedKey,
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
    const body = await req.json();
    const data = PostSchema.parse(body);

    const server = await db.server.findUnique({
      where: { id: serverId },
      select: { id: true, ownerId: true, currentKeyVersion: true },
    });
    if (!server) throw new ApiError("Server not found", 404);
    if (server.ownerId !== me.sub) {
      throw new ApiError("Only the server owner can write epoch wraps", 403);
    }

    await db.serverKey.upsert({
      where: {
        serverId_userId_version: {
          serverId,
          userId: data.userId,
          version: data.version,
        },
      },
      create: {
        serverId,
        userId: data.userId,
        version: data.version,
        ephemeralPub: data.ephemeralPub,
        iv: data.iv,
        wrappedKey: data.wrappedKey,
      },
      update: {
        ephemeralPub: data.ephemeralPub,
        iv: data.iv,
        wrappedKey: data.wrappedKey,
      },
    });

    if (data.bumpToCurrent && data.version > server.currentKeyVersion) {
      await db.server.update({
        where: { id: serverId },
        data: { currentKeyVersion: data.version },
      });
    }

    return Response.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
