# ZeroLayer

A Discord-style chat app with end-to-end encrypted text, voice, and video.
Self-hosted, zero cloud accounts to get started.

## Run it

You need [Docker](https://docs.docker.com/get-docker/) and
[Node 20+](https://nodejs.org). That's it.

```bash
git clone <this-repo> zerolayer && cd zerolayer
npm run local
```

The script does everything else: starts Postgres + TideCloak in Docker, sets
up the realm, writes your local `.env`, then launches the dev server.

Open **http://localhost:3000** when you see `Ready`.

Partway through, the script will print a Tide invite link and pause — open
it in your browser to link your Tide account, then come back to the
terminal. The bootstrap continues automatically.

## Day-to-day

```bash
npm run local          # bootstrap (if needed) + start dev server
npm run local:stop     # stop containers, keep your data
npm run local:status   # show what's running
npm run local:reset    # wipe everything and start over (asks first)
```

If you stop and come back later, `npm run local` skips the bootstrap and
just starts the dev server.

## Deploy it

When you're ready to put it online:

```bash
npm run deploy
```

It'll prompt for your hosted Supabase + TideCloak URLs and push them
straight to Vercel — no secrets touch your disk. See
[`scripts/deploy.sh`](scripts/deploy.sh) for what it asks for.

## Stack

Next.js 16 · TideCloak (auth + private-key self-encryption) · Supabase
(Postgres + Realtime) · Prisma · WebRTC · WebCrypto.

Encryption flow: each user has an ECDH P-256 keypair; the **private key**
is encrypted with TideCloak's self-encryption (only that user's identity
can unlock it). The **public key** wraps a per-server AES-GCM-256 epoch key
for every member, so the server only ever sees ciphertext.

## Secrets policy

Nothing sensitive is committed.

- `.env` and `.env.*` are gitignored — only `.env.example` ships.
- `public/adapter.json`, `data/`, and `public/uploads/` are gitignored.
- `npm run deploy` pushes hosted credentials to Vercel via the API and
  discards them — they never land in a file.
