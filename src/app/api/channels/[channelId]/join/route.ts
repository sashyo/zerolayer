import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, jsonError } from "@/lib/auth-server";
// (no per-channel role provisioning in keypair-mode)

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> },
) {
  try {
    const user = await requireAuth(req);
    const { channelId } = await params;

    const channel = await db.channel.findUnique({
      where: { id: channelId },
      select: { id: true, isPrivate: true, serverId: true },
    });
    if (!channel) return Response.json({ error: "Channel not found" }, { status: 404 });

    // Don't allow joining private channels via this endpoint (requires invite)
    if (channel.isPrivate) {
      return Response.json({ error: "Private channel" }, { status: 403 });
    }

    // Upsert membership
    await db.channelMember.upsert({
      where: { channelId_userId: { channelId, userId: user.sub } },
      create: { channelId, userId: user.sub },
      update: {},
    });

    return Response.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
