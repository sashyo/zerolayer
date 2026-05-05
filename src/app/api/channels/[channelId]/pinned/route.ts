/**
 * GET /api/channels/[channelId]/pinned — list pinned messages.
 *
 * Same shape as messages GET but filtered to isPinned=true and ordered by
 * pinnedAt desc. Members of the channel only.
 */
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, jsonError, ApiError } from "@/lib/auth-server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> },
) {
  try {
    const me = await requireAuth(req);
    const { channelId } = await params;

    const member = await db.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId: me.sub } },
    });
    if (!member) throw new ApiError("Not a member of this channel", 403);

    const messages = await db.message.findMany({
      where: { channelId, isPinned: true },
      orderBy: { pinnedAt: "desc" },
      take: 50,
      include: {
        author: true,
        attachments: true,
        reactions: { include: { user: true } },
        replyTo: { include: { author: true } },
      },
    });

    return Response.json({
      messages: messages.map((m) => serializeMessage(m, me.sub)),
    });
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
