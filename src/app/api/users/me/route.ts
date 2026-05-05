import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth, jsonError } from "@/lib/auth-server";

const PatchSchema = z.object({
  displayName: z.string().min(1).max(60).optional(),
  bio: z.string().max(500).nullable().optional(),
  pronouns: z.string().max(32).nullable().optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "must be a #RRGGBB color")
    .nullable()
    .optional(),
  // Avatar is stored as either an http(s) URL or a small data URL (we resize
  // client-side). We cap the string at ~140 KB so DB rows stay reasonable.
  avatarUrl: z
    .string()
    .max(140_000)
    .refine(
      (s) => /^(https?:\/\/|data:image\/)/.test(s),
      "avatarUrl must be http(s) or a data:image URL",
    )
    .nullable()
    .optional(),
});

// GET /api/users/me — upsert current user and return their profile
export async function GET(req: NextRequest) {
  try {
    const token = await requireAuth(req);

    // The JWT may not always carry preferred_username (depends on mappers).
    // Fall back to email-local-part, then to sub, so create never fails on
    // a missing required field.
    const fallbackUsername =
      token.preferred_username ||
      token.email?.split("@")[0] ||
      `user_${token.sub.slice(0, 8)}`;
    const fallbackDisplay =
      token.name || token.preferred_username || fallbackUsername;

    // Reconcile id ↔ username (see /api/users/me/keys for rationale).
    // IMPORTANT: when the user already exists we DO NOT overwrite their
    // displayName or avatarUrl from the JWT — those are user-editable via
    // PATCH /api/users/me, and clobbering them here was the bug behind
    // "I changed my display name but it reverts on next refresh".
    const existingById = await db.user.findUnique({ where: { id: token.sub } });
    let user;
    if (existingById) {
      user = await db.user.update({
        where: { id: token.sub },
        data: { status: "ONLINE" },
      });
    } else {
      const existingByName = await db.user.findUnique({
        where: { username: fallbackUsername },
      });
      if (existingByName) {
        // We only get here for a one-time id reconciliation (legacy rows).
        // Keep any displayName/avatarUrl the user has already set.
        user = await db.user.update({
          where: { username: fallbackUsername },
          data: {
            id: token.sub,
            status: "ONLINE",
          },
        });
      } else {
        user = await db.user.create({
          data: {
            id: token.sub,
            username: fallbackUsername,
            displayName: fallbackDisplay,
            avatarUrl: token.picture ?? null,
            status: "ONLINE",
          },
        });
      }
    }

    return Response.json({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      bio: user.bio ?? null,
      pronouns: user.pronouns ?? null,
      accentColor: user.accentColor ?? null,
      createdAt: user.createdAt.toISOString(),
      status: user.status,
    });
  } catch (err) {
    return jsonError(err);
  }
}

// PATCH /api/users/me — update editable profile fields.
export async function PATCH(req: NextRequest) {
  try {
    const me = await requireAuth(req);
    const body = await req.json();
    const data = PatchSchema.parse(body);

    const user = await db.user.update({
      where: { id: me.sub },
      data: {
        ...(data.displayName !== undefined ? { displayName: data.displayName } : {}),
        ...(data.bio !== undefined ? { bio: data.bio } : {}),
        ...(data.pronouns !== undefined ? { pronouns: data.pronouns } : {}),
        ...(data.accentColor !== undefined ? { accentColor: data.accentColor } : {}),
        ...(data.avatarUrl !== undefined ? { avatarUrl: data.avatarUrl } : {}),
      },
    });

    return Response.json({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl ?? null,
      bio: user.bio ?? null,
      pronouns: user.pronouns ?? null,
      accentColor: user.accentColor ?? null,
      createdAt: user.createdAt.toISOString(),
    });
  } catch (err) {
    return jsonError(err);
  }
}
