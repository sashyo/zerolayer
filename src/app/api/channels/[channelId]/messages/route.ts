import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth, jsonError, ApiError } from "@/lib/auth-server";
import { checkRateLimit } from "@/lib/rate-limit";
import type { SerializedMessage } from "@/types";

const SendMessageSchema = z.object({
  content: z.string().min(1).max(100_000), // base64(iv ‖ ciphertext)
  keyVersion: z.number().int().positive().default(1),
  type: z.enum(["TEXT", "IMAGE", "FILE", "SYSTEM"]).default("TEXT"),
  attachmentIds: z.array(z.string()).max(10).optional(),
  replyToId: z.string().optional(),
  mentions: z.array(z.string()).max(50).optional(),
});

// GET /api/channels/[channelId]/messages?before=<cursor>&limit=50
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> },
) {
  try {
    const user = await requireAuth(req);
    const { channelId } = await params;

    // Verify membership
    const member = await db.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId: user.sub } },
    });
    if (!member) throw new ApiError("Not a member of this channel", 403);

    const { searchParams } = new URL(req.url);
    const before = searchParams.get("before"); // cursor (message id)
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);

    const messages = await db.message.findMany({
      where: {
        channelId,
        ...(before ? { id: { lt: before } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      include: {
        author: true,
        attachments: true,
        reactions: { include: { user: true } },
        replyTo: { include: { author: true } },
      },
    });

    const hasMore = messages.length > limit;
    const page = hasMore ? messages.slice(0, limit) : messages;

    // Update last-read cursor
    await db.channelMember.update({
      where: { channelId_userId: { channelId, userId: user.sub } },
      data: { lastReadAt: new Date() },
    });

    return Response.json({
      messages: page.map((m) => serializeMessage(m, user.sub)).reverse(),
      hasMore,
      cursor: hasMore ? page[page.length - 1].id : null,
    });
  } catch (err) {
    return jsonError(err);
  }
}

// POST /api/channels/[channelId]/messages — persist an encrypted message
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> },
) {
  try {
    const user = await requireAuth(req);
    const { channelId } = await params;

    // Rate limiting per user
    const rl = checkRateLimit(`msg:${user.sub}`);
    if (!rl.allowed) {
      return Response.json(
        { error: "Rate limit exceeded", resetAt: rl.resetAt },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
        },
      );
    }

    const member = await db.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId: user.sub } },
    });
    if (!member) throw new ApiError("Not a member of this channel", 403);

    const body = await req.json();
    const data = SendMessageSchema.parse(body);

    const message = await db.message.create({
      data: {
        channelId,
        authorId: user.sub,
        content: data.content, // ciphertext — server never sees plaintext
        keyVersion: data.keyVersion,
        type: data.type,
        replyToId: data.replyToId ?? null,
        mentions: data.mentions ?? [],
        ...(data.attachmentIds?.length
          ? {
              attachments: {
                connect: data.attachmentIds.map((id) => ({ id })),
              },
            }
          : {}),
      },
      include: {
        author: true,
        attachments: true,
        reactions: { include: { user: true } },
        replyTo: { include: { author: true } },
      },
    });

    return Response.json({ message: serializeMessage(message, user.sub) }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}

// ── Serializer ────────────────────────────────────────────────────────────────

function serializeMessage(message: any, viewerUserId: string): SerializedMessage {
  // Aggregate reactions: { emoji → {count, me, users} }
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
