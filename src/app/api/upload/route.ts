/**
 * File upload endpoint — stores files locally under public/uploads/.
 * For production, swap the disk write for an S3 PutObject call.
 *
 * Files are NOT encrypted server-side (they're binary and large).
 * The client should encrypt sensitive attachments using IAMService.doEncrypt
 * before uploading if E2EE for files is required.
 */
import { NextRequest } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { requireAuth, jsonError, ApiError } from "@/lib/auth-server";
import { db } from "@/lib/db";
import { nanoid } from "nanoid";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./public/uploads";
const MAX_SIZE = parseInt(process.env.MAX_FILE_SIZE || "10485760", 10); // 10 MB

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "text/plain",
  "application/zip",
  "video/mp4",
  "audio/mpeg",
  "audio/ogg",
]);

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req);

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const channelId = formData.get("channelId") as string | null;

    if (!file) throw new ApiError("No file provided", 400);
    if (!channelId) throw new ApiError("channelId is required", 400);

    // Verify membership
    const member = await db.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId: user.sub } },
    });
    if (!member) throw new ApiError("Not a member of this channel", 403);

    if (file.size > MAX_SIZE) {
      throw new ApiError(`File too large (max ${MAX_SIZE / 1_048_576} MB)`, 413);
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      throw new ApiError("File type not allowed", 415);
    }

    // Sanitise filename — strip path components, keep extension
    const ext = path.extname(file.name).toLowerCase().replace(/[^a-z0-9.]/g, "");
    const id = nanoid(12);
    const filename = `${id}${ext}`;
    const uploadPath = path.join(UPLOAD_DIR, filename);

    await mkdir(UPLOAD_DIR, { recursive: true });
    const bytes = new Uint8Array(await file.arrayBuffer());
    await writeFile(uploadPath, bytes);

    const baseUrl =
      process.env.NEXT_PUBLIC_UPLOAD_BASE_URL || "http://localhost:3000/uploads";
    const url = `${baseUrl}/${filename}`;

    // Create an orphaned attachment — linked to a message on POST /messages
    const attachment = await db.attachment.create({
      data: {
        // temporarily link to a system message placeholder — must be replaced
        messageId: "pending",
        filename: file.name,
        url,
        size: file.size,
        mimeType: file.type,
      },
    });

    return Response.json({ id: attachment.id, url, filename: file.name, size: file.size });
  } catch (err) {
    return jsonError(err);
  }
}
