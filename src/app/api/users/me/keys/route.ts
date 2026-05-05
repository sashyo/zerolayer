/**
 * User keypair storage.
 *
 *   GET  /api/users/me/keys
 *      → { publicKey, encryptedPrivateKey } | { publicKey: null, encryptedPrivateKey: null }
 *
 *   POST /api/users/me/keys     body: { publicKey, encryptedPrivateKey }
 *      Stores or replaces the caller's keypair. Both fields are base64.
 *      The server never sees the plaintext private key — only the
 *      TideCloak-self-encrypted ciphertext.
 *
 * Replacing the keypair invalidates every existing server-key wrap for this
 * user (because the wraps were ECDH'd against the old public key). In the
 * current build, callers don't replace; this is left as a future concern.
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth, jsonError } from "@/lib/auth-server";

const Schema = z.object({
  publicKey: z.string().min(20).max(4096),
  encryptedPrivateKey: z.string().min(20).max(65536),
});

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireAuth(req);
    await db.user.update({
      where: { id: user.sub },
      data: { publicKey: null, encryptedPrivateKey: null },
    });
    return Response.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req);
    const u = await db.user.findUnique({
      where: { id: user.sub },
      select: { publicKey: true, encryptedPrivateKey: true },
    });
    return Response.json({
      publicKey: u?.publicKey ?? null,
      encryptedPrivateKey: u?.encryptedPrivateKey ?? null,
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req);
    const body = await req.json();
    const data = Schema.parse(body);

    const fallbackUsername =
      user.preferred_username ||
      user.email?.split("@")[0] ||
      `user_${user.sub.slice(0, 8)}`;
    const fallbackDisplay =
      user.name || user.preferred_username || fallbackUsername;

    // Reconcile stale rows. We prefer matching by id (TideCloak sub), but if
    // that misses we may still find a row with the same username from an
    // earlier session/realm-reset. In that case we re-key it onto the new id
    // rather than crashing on a unique constraint. This is dev-pragmatic; in
    // production the realm-reset case shouldn't happen.
    const existingById = await db.user.findUnique({ where: { id: user.sub } });
    if (existingById) {
      await db.user.update({
        where: { id: user.sub },
        data: {
          publicKey: data.publicKey,
          encryptedPrivateKey: data.encryptedPrivateKey,
        },
      });
    } else {
      const existingByName = await db.user.findUnique({
        where: { username: fallbackUsername },
      });
      if (existingByName) {
        // Re-key: replace the orphan row's id with the current sub. Note the
        // old id is referenced by FKs (servers.ownerId, server_members.userId,
        // ...). Postgres ON UPDATE CASCADE handles those for us in this schema.
        await db.user.update({
          where: { username: fallbackUsername },
          data: {
            id: user.sub,
            publicKey: data.publicKey,
            encryptedPrivateKey: data.encryptedPrivateKey,
            displayName: fallbackDisplay,
            avatarUrl: user.picture ?? null,
          },
        });
      } else {
        await db.user.create({
          data: {
            id: user.sub,
            username: fallbackUsername,
            displayName: fallbackDisplay,
            avatarUrl: user.picture ?? null,
            publicKey: data.publicKey,
            encryptedPrivateKey: data.encryptedPrivateKey,
          },
        });
      }
    }

    return Response.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
