/**
 * GET /api/users/[userId]/profile — public profile fields.
 *
 * Anyone authenticated can read; the response is intentionally narrow (no
 * email, no privateKey, no last-seen). Used by the ProfilePopover when the
 * user clicks an avatar.
 */
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, jsonError, ApiError } from "@/lib/auth-server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    await requireAuth(req);
    const { userId } = await params;

    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        bio: true,
        pronouns: true,
        accentColor: true,
        createdAt: true,
      },
    });
    if (!user) throw new ApiError("User not found", 404);

    return Response.json({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      bio: user.bio ?? null,
      pronouns: user.pronouns ?? null,
      accentColor: user.accentColor ?? null,
      createdAt: user.createdAt.toISOString(),
    });
  } catch (err) {
    return jsonError(err);
  }
}
