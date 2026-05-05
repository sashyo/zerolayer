/**
 * POST /api/channels/[channelId]/messages/[messageId]/pin   — pin
 * DELETE  /api/channels/[channelId]/messages/[messageId]/pin   — unpin
 *
 * Server-owner-only. Pin state is plaintext metadata (boolean + timestamp);
 * message content stays E2EE-ciphertext on the server. Clients must already
 * have the right epoch wrap to actually decrypt and display the pinned text.
 */
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, jsonError, ApiError } from "@/lib/auth-server";

async function loadAndAuthorize(
  req: NextRequest,
  channelId: string,
  messageId: string,
) {
  const me = await requireAuth(req);
  const msg = await db.message.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      channelId: true,
      channel: { select: { server: { select: { ownerId: true } } } },
    },
  });
  if (!msg || msg.channelId !== channelId)
    throw new ApiError("Message not found", 404);
  const ownerId = msg.channel?.server?.ownerId ?? null;
  if (!ownerId || ownerId !== me.sub)
    throw new ApiError("Only the server owner can pin/unpin", 403);
  return { me, msg };
}

async function setPinned(
  req: NextRequest,
  channelId: string,
  messageId: string,
  pinned: boolean,
) {
  const { me } = await loadAndAuthorize(req, channelId, messageId);
  const updated = await db.message.update({
    where: { id: messageId },
    data: { isPinned: pinned, pinnedAt: pinned ? new Date() : null },
    include: {
      author: true,
      attachments: true,
      reactions: { include: { user: true } },
      replyTo: { include: { author: true } },
    },
  });
  return Response.json({ message: serializeMessage(updated, me.sub) });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string; messageId: string }> },
) {
  try {
    const { channelId, messageId } = await params;
    return await setPinned(req, channelId, messageId, true);
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string; messageId: string }> },
) {
  try {
    const { channelId, messageId } = await params;
    return await setPinned(req, channelId, messageId, false);
  } catch (err) {
    return jsonError(err);
  }
}

function serializeMessage(message: any, viewerUserId: string) {
  const reactionMap = new Map<
    string,
    { count: number; me: boolean; users: Array<{ id: string; displayName: string }> }
  >();
  for (const r of message.reactions) {
    const existing = reactionMap.get(r.emoji) ?? { count: 0, me: false, users: [] };
    reactionMap.set(r.emoji, {
      count: existing.count + 1,
      me: existing.me || r.userId === viewerUserId,
      users: [
        ...existing.users,
        {
          id: r.userId,
          displayName:
            r.user?.displayName || r.user?.username || r.userId.slice(0, 6),
        },
      ],
    });
  }
  return {
    id: message.id,
    channelId: message.channelId,
    authorId: message.authorId,
    content: message.content,
    keyVersion: message.keyVersion ?? 1,
    type: message.type,
    replyToId: message.replyToId ?? null,
    replyTo: message.replyTo
      ? {
          id: message.replyTo.id,
          authorId: message.replyTo.authorId,
          content: message.replyTo.content,
          keyVersion: message.replyTo.keyVersion ?? 1,
          author: {
            id: message.replyTo.author.id,
            username: message.replyTo.author.username,
            displayName: message.replyTo.author.displayName,
          },
        }
      : null,
    editedAt: message.editedAt?.toISOString() ?? null,
    createdAt: message.createdAt.toISOString(),
    author: {
      id: message.author.id,
      username: message.author.username,
      displayName: message.author.displayName,
      avatarUrl: message.author.avatarUrl,
      accentColor: message.author.accentColor ?? null,
      status: message.author.status,
    },
    attachments: message.attachments.map((a: any) => ({
      id: a.id,
      messageId: a.messageId,
      filename: a.filename,
      url: a.url,
      size: a.size,
      mimeType: a.mimeType,
    })),
    reactions: Array.from(reactionMap.entries()).map(([emoji, { count, me, users }]) => ({
      emoji,
      count,
      me,
      users,
    })),
    mentions: message.mentions ?? [],
    isPinned: !!message.isPinned,
    pinnedAt: message.pinnedAt?.toISOString() ?? null,
  };
}
