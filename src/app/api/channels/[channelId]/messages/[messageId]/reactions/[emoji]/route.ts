/**
 * POST   /api/channels/[c]/messages/[m]/reactions/[emoji] — add my reaction
 * DELETE same path                                         — remove my reaction
 *
 * Caller must be a member of the channel. Reactions are 1:1:1 (message, user,
 * emoji); the unique index gives us idempotency for re-clicks.
 */
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, jsonError, ApiError } from "@/lib/auth-server";

async function checkMembership(channelId: string, userId: string) {
  const member = await db.channelMember.findUnique({
    where: { channelId_userId: { channelId, userId } },
  });
  if (!member) throw new ApiError("Not a channel member", 403);
}

async function ensureMessageInChannel(
  channelId: string,
  messageId: string,
): Promise<void> {
  const m = await db.message.findUnique({
    where: { id: messageId },
    select: { id: true, channelId: true },
  });
  if (!m || m.channelId !== channelId) {
    throw new ApiError("Message not found", 404);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string; messageId: string; emoji: string }> },
) {
  try {
    const me = await requireAuth(req);
    const { channelId, messageId, emoji } = await params;
    const decodedEmoji = decodeURIComponent(emoji);

    await checkMembership(channelId, me.sub);
    await ensureMessageInChannel(channelId, messageId);

    await db.reaction.upsert({
      where: {
        messageId_userId_emoji: {
          messageId,
          userId: me.sub,
          emoji: decodedEmoji,
        },
      },
      create: { messageId, userId: me.sub, emoji: decodedEmoji },
      update: {},
    });

    return Response.json({ ok: true, emoji: decodedEmoji });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string; messageId: string; emoji: string }> },
) {
  try {
    const me = await requireAuth(req);
    const { channelId, messageId, emoji } = await params;
    const decodedEmoji = decodeURIComponent(emoji);

    await checkMembership(channelId, me.sub);
    await ensureMessageInChannel(channelId, messageId);

    await db.reaction
      .delete({
        where: {
          messageId_userId_emoji: {
            messageId,
            userId: me.sub,
            emoji: decodedEmoji,
          },
        },
      })
      .catch(() => {}); // not present is fine

    return Response.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
