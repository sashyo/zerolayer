// ─── Shared types used across client and server ───────────────────────────────

export type UserStatus = "ONLINE" | "IDLE" | "DND" | "OFFLINE";
export type ChannelType = "TEXT" | "VOICE" | "DM" | "GROUP_DM";
export type MessageType = "TEXT" | "IMAGE" | "FILE" | "SYSTEM";

// ── Serialized DB models (safe to send over the wire) ─────────────────────────

export interface SerializedUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  accentColor: string | null;
  status: UserStatus;
}

export interface SerializedServer {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  inviteCode: string;
  ownerId: string;
  srvAdminRoleId: string | null;
  srvMemberRoleId: string | null;
  approvalPolicySignedAt: string | null;
  channels: SerializedChannel[];
  categories: SerializedCategory[];
  members: SerializedMember[];
  roles: SerializedRole[];
}

export interface SerializedChannel {
  id: string;
  serverId: string | null;
  name: string;
  description: string | null;
  type: ChannelType;
  isPrivate: boolean;
  position: number;
  categoryId: string | null;
  // No per-channel encryption material in keypair-mode — server epoch governs.
}

export interface SerializedCategory {
  id: string;
  serverId: string;
  name: string;
  position: number;
}

export interface SerializedRole {
  id: string;
  serverId: string;
  name: string;
  color: string;
  permissions: string; // BigInt serialised as string
  position: number;
  isDefault: boolean;
}

export interface SerializedMember {
  userId: string;
  serverId: string;
  roleId: string | null;
  nickname: string | null;
  user: SerializedUser;
  role: SerializedRole | null;
}

export interface SerializedMessage {
  id: string;
  channelId: string;
  authorId: string;
  content: string;        // base64( iv(12) ‖ AES-GCM ciphertext )
  keyVersion: number;     // server epoch this message was encrypted under
  type: MessageType;
  replyToId: string | null;
  replyTo: SerializedReplyPreview | null;
  editedAt: string | null;
  createdAt: string;
  author: SerializedUser;
  attachments: SerializedAttachment[];
  reactions: SerializedReaction[];
  mentions: string[];
  isPinned: boolean;
  pinnedAt: string | null;
}

export interface SerializedReplyPreview {
  id: string;
  authorId: string;
  content: string;        // ciphertext — caller decrypts with keyVersion
  keyVersion: number;
  author: {
    id: string;
    username: string;
    displayName: string;
  };
}

export interface SerializedAttachment {
  id: string;
  messageId: string;
  filename: string;
  url: string;
  size: number;
  mimeType: string;
}

export interface SerializedReaction {
  emoji: string;
  count: number;
  me: boolean;            // has the viewing user reacted?
  users?: Array<{ id: string; displayName: string }>;
}

// ── Socket.IO event payloads ──────────────────────────────────────────────────

export interface TypingEvent {
  userId: string;
  username: string;
  channelId: string;
}

export interface PresenceEvent {
  userId: string;
}

export interface ReactionToggleEvent {
  channelId: string;
  messageId: string;
  emoji: string;
  userId: string;
  added: boolean;
}

// ── API request / response shapes ────────────────────────────────────────────

export interface CreateServerBody {
  name: string;
  description?: string;
}

export interface CreateChannelBody {
  name: string;
  type?: ChannelType;
  description?: string;
  isPrivate?: boolean;
}

export interface SendMessageBody {
  content: string;       // base64( iv ‖ AES-GCM ciphertext )
  keyVersion?: number;
  type?: MessageType;
  attachmentIds?: string[];
}

export interface PaginationMeta {
  total: number;
  hasMore: boolean;
  cursor: string | null;
}
