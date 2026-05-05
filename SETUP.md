# ZeroLayer — Setup Guide

A Discord-inspired secure chat application with end-to-end encryption powered by
TideCloak's Forseti policy engine.  Messages are encrypted in the browser before
they reach the server; the server stores and delivers only ciphertext.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Browser                                                    │
│  ┌─────────────────────────────────────────────┐            │
│  │  Next.js App (React)                        │            │
│  │  ┌─────────────────────────────────────┐   │            │
│  │  │  IAMService.doEncrypt(text, policy)  │   │            │
│  │  │  → ciphertext (Base64)              │   │            │
│  │  └──────────────┬──────────────────────┘   │            │
│  └─────────────────┼──────────────────────────┘            │
│                    │ REST POST /api/messages                 │
└────────────────────┼────────────────────────────────────────┘
                     │  ciphertext only (no plaintext)
┌────────────────────▼────────────────────────────────────────┐
│  ZeroLayer Server (Next.js + Socket.IO)                     │
│  • Verifies JWT from TideCloak                              │
│  • Stores ciphertext in PostgreSQL                          │
│  • Never decrypts messages                                  │
│  • Broadcasts ciphertext to channel via Socket.IO           │
└────────────────────────────────────────────────────────────-┘
                     │  JWKS verification
┌────────────────────▼────────────────────────────────────────┐
│  TideCloak (Keycloak + Tide extensions)                     │
│  • Issues JWT tokens with doken for E2EE                    │
│  • Runs Forseti contracts on ORK network                    │
│  • Manages channel roles (ch_<channelId>)                   │
│  • VVK threshold-signs encryption policies                  │
└─────────────────────────────────────────────────────────────┘
```

---

## E2EE Model

### How encryption works in ZeroLayer

```
Send:
  plaintext → IAMService.doEncrypt([{data, tags:["x"]}], policyBytes)
            → Base64 ciphertext → REST POST → stored in DB

Receive:
  Base64 ciphertext (from DB or Socket.IO)
  → IAMService.doDecrypt([{encrypted, tags:["x"]}], policyBytes)
  → plaintext (rendered in browser only)
```

### Why Forseti policy-based encryption?

| Requirement           | Self-Encryption (no policy) | Forseti Policy |
|-----------------------|-----------------------------|----------------|
| Only sender decrypts  | ✓                           | ✓              |
| Group decryption      | ✗ (identity-bound)          | ✓              |
| DM (2-party)          | ✗                           | ✓              |
| Role-revocation works | ✗                           | ✓              |
| One contract, N chans | —                           | ✓ (Role param) |

Self-encryption is identity-bound — even if you give another user the same
`selfdecrypt` role, they CANNOT decrypt your ciphertext.  Forseti policy-based
encryption uses the VVK (organizational key distributed across ORKs) so any user
whose doken satisfies the contract can decrypt.

### Roles

| Role                   | Purpose                                               |
|------------------------|-------------------------------------------------------|
| `_tide_x.selfencrypt`  | Voucher gate — enables vendorsign (encrypt) action    |
| `_tide_x.selfdecrypt`  | Voucher gate — enables vendordecrypt (decrypt) action |
| `ch_<channelId>`       | Forseti role — grants access to decrypt channel msgs  |

The first two are generic and assigned to ALL users at registration.
The third is per-channel and assigned when a user joins, revoked when they leave.

---

## Prerequisites

- **PostgreSQL 14+**
- **Node.js 20+**
- **TideCloak** running (development image or production)
  - Realm: `zerolayer` (configurable in `.env`)
  - Client: `zerolayer-app` with OIDC redirect URIs set
  - ORK network connected (required for Forseti / encryption)

---

## Step 1: Clone and install

```bash
cd ZeroLayer
cp .env.example .env
npm install
```

---

## Step 2: Configure environment

Edit `.env`:

```env
# TideCloak (your server)
TIDECLOAK_URL=http://localhost:8080
TIDECLOAK_REALM=zerolayer
TIDECLOAK_CLIENT_ID=zerolayer-app
TIDECLOAK_CLIENT_SECRET=<client-secret>
TIDECLOAK_ADMIN_USER=admin
TIDECLOAK_ADMIN_PASSWORD=<admin-password>

# Frontend (same values, NEXT_PUBLIC_ prefix)
NEXT_PUBLIC_TIDECLOAK_URL=http://localhost:8080
NEXT_PUBLIC_TIDECLOAK_REALM=zerolayer
NEXT_PUBLIC_TIDECLOAK_CLIENT_ID=zerolayer-app

# Database
DATABASE_URL="postgresql://zerolayer:password@localhost:5432/zerolayer_db"
```

Update `public/tidecloak.json` to match:

```json
{
  "realm": "zerolayer",
  "auth-server-url": "http://localhost:8080/",
  "resource": "zerolayer-app",
  "public-client": true
}
```

---

## Step 3: Set up TideCloak realm

In the TideCloak admin UI (`http://localhost:8080/admin`):

### 3a. Create realm `zerolayer`

### 3b. Create client `zerolayer-app`
- Client type: OpenID Connect
- Client authentication: OFF (public client)
- Valid redirect URIs: `http://localhost:3000/*`
- Web origins: `http://localhost:3000`

### 3c. Create voucher gate realm roles (assign to all users)

```
_tide_x.selfencrypt
_tide_x.selfdecrypt
```

Add both to the default composite role so every new user gets them automatically.

### 3d. Create a default composite role

Create role `default-roles-zerolayer` and add:
- `_tide_x.selfencrypt`
- `_tide_x.selfdecrypt`

---

## Step 4: Database setup

```bash
npm run db:push       # push schema (dev)
# or
npm run db:migrate    # create migration files (prod)
```

---

## Step 5: Deploy the Forseti contract

The `ChannelAccessContract.cs` contract is deployed automatically during the first
channel creation via `PolicySignRequest.addForsetiContractToUpload()`.

**Manual verification** — after creating the first channel, you can confirm
the contract is deployed:

```bash
curl -s "$TIDECLOAK_URL/admin/realms/zerolayer/tide-admin/forseti-contracts" \
  -H "Authorization: Bearer <admin-token>" | jq '.[].name'
# Should show: "ChannelAccessContract"
```

---

## Step 6: Start the app

```bash
npm run dev        # development (hot reload)
npm run build && npm start  # production
```

Open http://localhost:3000 — you will be redirected to TideCloak for login.

---

## Step 7: First use — create a server and sign the E2EE policy

1. Log in with your TideCloak account
2. Click **+** in the server rail → **Create Server**
3. Click **+** next to "Text Channels" → **Create Channel**
4. Fill in the channel name and click **Create Channel**
5. The 5-step Forseti signing flow starts automatically:
   - The app initializes a `PolicySignRequest` with the `ChannelAccessContract`
   - A TideCloak **admin approval popup** appears — approve it
   - The ORK network signs the policy with the VVK
   - Signed bytes are stored in the database
6. The channel header shows a green **E2EE** badge
7. Start typing — messages are encrypted before leaving your browser

---

## Scaling recommendations

### Horizontal scaling

```
Client ─── Load Balancer ─── App servers (N instances)
                │
                └── Redis pub/sub (Socket.IO adapter)
                    PostgreSQL (shared)
```

```bash
npm install @socket.io/redis-adapter ioredis
```

In `src/lib/socket-server.ts`, add:

```ts
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "ioredis";

const pub = createClient({ url: process.env.REDIS_URL });
const sub = pub.duplicate();
await Promise.all([pub.connect(), sub.connect()]);
io.adapter(createAdapter(pub, sub));
```

### Database

- Add a read replica for message history queries
- Index on `(channelId, createdAt)` already in schema
- Consider pgvector for semantic message search
- Archive old messages to S3 / object storage

### File storage

Replace local disk writes in `src/app/api/upload/route.ts` with S3:

```ts
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
const s3 = new S3Client({ region: process.env.AWS_REGION });
await s3.send(new PutObjectCommand({ Bucket, Key, Body: bytes, ContentType: mimeType }));
```

### Rate limiting

Replace the in-memory store in `src/lib/rate-limit.ts` with Redis:

```ts
const count = await redis.incr(`rl:${key}`);
if (count === 1) await redis.expire(`rl:${key}`, windowSeconds);
```

---

## Security notes

| Threat                    | Mitigation                                                     |
|---------------------------|----------------------------------------------------------------|
| Server reads messages     | Only ciphertext stored — server has no decryption key          |
| Token theft               | DPoP binds tokens to device (add `useDPoP` to SDK config)     |
| Role abuse                | TideCloak IGA requires multi-admin approval for role changes   |
| Revocation lag            | ORK role cache up to 120 s; critical operations use immediate  |
| Replay attacks            | Per-message ephemeral encryption keys (no key reuse)           |
| Offline decryption        | Impossible — ORK network participation required                |
| Rate limit bypass         | Per-user rate limiting; swap for Redis in production           |
| File upload attacks       | MIME type allow-list, size limit, sanitised filenames          |
| Input injection           | Zod validation on all API inputs                               |
| CORS                      | Same-origin proxy for TideCloak admin policy endpoint          |

---

## Project structure

```
ZeroLayer/
├── server.ts                    # Custom HTTP server (Next.js + Socket.IO)
├── contracts/
│   └── ChannelAccessContract.cs # Forseti policy contract (deployed once)
├── prisma/
│   └── schema.prisma            # PostgreSQL schema
├── public/
│   └── tidecloak.json           # OIDC config (must match .env)
└── src/
    ├── app/
    │   ├── (app)/               # Authenticated route group
    │   │   ├── channels/@me/    # DM pages
    │   │   └── servers/         # Server/channel pages
    │   └── api/                 # REST API routes
    │       ├── channels/[id]/
    │       │   ├── messages/    # GET history, POST new message
    │       │   └── policy/      # GET/POST Forseti signed policy bytes
    │       ├── servers/         # CRUD servers + channels
    │       ├── dm/              # DM channel management
    │       ├── upload/          # File uploads
    │       └── proxy/           # TideCloak admin policy CORS proxy
    ├── components/
    │   ├── chat/                # MessageList, MessageInput (E2EE), TypingIndicator
    │   ├── layout/              # AppShell, ServerRail, ChannelSidebar, MemberList
    │   ├── modals/              # CreateServer, CreateChannel (Forseti signing)
    │   └── providers/           # TideCloakProvider, SocketProvider
    ├── hooks/
    │   ├── useChannelPolicy.ts  # Fetches + caches signed Forseti policy bytes
    │   ├── useMessages.ts       # Fetch, decrypt, Socket.IO updates
    │   └── useTyping.ts         # Typing indicator state
    └── lib/
        ├── auth-server.ts       # JWT verification (jose + TideCloak JWKS)
        ├── db.ts                # Prisma singleton
        ├── socket-server.ts     # Socket.IO setup (typing, presence, broadcast)
        ├── tidecloak-admin.ts   # Admin API: create/assign/revoke channel roles
        └── rate-limit.ts        # In-memory rate limiter
```
