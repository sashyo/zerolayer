/**
 * PATCH  /api/channels/[channelId]/messages/[messageId]   — edit
 *   body: { content, keyVersion }   (ciphertext + version, same shape as send)
 *   Author-only. Server never sees plaintext; we just swap the ciphertext blob
 *   and stamp `editedAt`.
 *
 * DELETE /api/channels/[channelId]/messages/[messageId]   — delete
 *   Author OR server owner.
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth, jsonError, ApiError } from "@/lib/auth-server";

const PatchSchema = z.object({
  content: z.string().min(1).max(100_000),
  keyVersion: z.number().int().positive(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string; messageId: string }> },
) {
  try {
    const me = await requireAuth(req);
    const { channelId, messageId } = await params;
    const body = await req.json();
    const data = PatchSchema.parse(body);

    const existing = await db.message.findUnique({
      where: { id: messageId },
      select: { id: true, authorId: true, channelId: true },
    });
    if (!existing || existing.channelId !== channelId)
      throw new ApiError("Message not found", 404);
    if (existing.authorId !== me.sub) {
      throw new ApiError("You can only edit your own messages", 403);
    }

    const updated = await db.message.update({
      where: { id: messageId },
      data: {
        content: data.content,
        keyVersion: data.keyVersion,
        editedAt: new Date(),
      },
      include: {
        author: true,
        attachments: true,
        reactions: { include: { user: true } },
        replyTo: { include: { author: true } },
      },
    });

    return Response.json({ message: serializeMessage(updated, me.sub) });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string; messageId: string }> },
) {
  try {
    const me = await requireAuth(req);
    const { channelId, messageId } = await params;

    const existing = await db.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        authorId: true,
        channelId: true,
        channel: { select: { server: { select: { ownerId: true } } } },
      },
    });
    if (!existing || existing.channelId !== channelId)
      throw new ApiError("Message not found", 404);

    const isAuthor = existing.authorId === me.sub;
    const isOwner = existing.channel?.server?.ownerId === me.sub;
    if (!isAuthor && !isOwner) {
      throw new ApiError("Not allowed to delete this message", 403);
    }

    await db.message.delete({ where: { id: messageId } });
    return Response.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}

// ── shared serializer ────────────────────────────────────────────────────────

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
