# Build ZeroLayer — a Discord-style E2EE chat app on TideCloak

Copy-paste this whole block to an AI coding agent that has the `tide-agent-pack` MCP loaded.

---

## The Prompt

> Build **ZeroLayer**, a Discord-style chat app with end-to-end encrypted text + voice + video. **Local-first** — everything must run on the developer's machine via Docker (TideCloak, Postgres, Supabase Realtime). No hosted services required. Stack: Next.js 16 App Router (App-only, no custom server), TideCloak for auth + private-key protection, **local Supabase stack via the Supabase CLI** (Postgres + Realtime in Docker), Prisma as ORM, WebRTC mesh for voice/video, WebCrypto for everything else.
>
> **Route first, then act.** Use the development team model. Do not bundle all work into one pass.
>
> ---
>
> ### Scenario routing — read this carefully
>
> Match scenario `encrypted-communication` in `reference-apps/INDEX.md` (real-time encrypted messaging, zero-knowledge server, hybrid encryption pattern). Use its manifest verbatim for roles, policies, and playbook order.
>
> **Use self-encrypt / self-decrypt for the start of the flow. Do NOT use policy-based / Forseti VVK encryption.**
>
> Concretely:
> - Layer 1 (Tide, identity-bound): each user's **ECDH P-256 private key** is encrypted with `IAMService.doEncrypt(privKeyDer, "<tag>")` and stored. On every login it's recovered with `IAMService.doDecrypt(...)`.
> - Layer 2 (external WebCrypto, runs in-browser): a per-server **epoch key** (AES-GCM-256) encrypts every message in that server. The epoch is **wrapped per-member via ECDH-ES + HKDF + AES-GCM** using the recipient's published public key. Server stores only ciphertext + the wrap blob; it never sees plaintext or any private key.
> - DM 1:1 keys are **derived from ECDH(myPriv, theirPub)** — no wrap blob needed.
> - Group DM keys may use a channel-id-derived AES key for transport encryption as a stop-gap (clearly marked as **not** real E2EE in the UI).
>
> Roles to create (the playbook will do this — confirm against the manifest):
> - `_tide_enabled`
> - `_tide_x.selfencrypt`
> - `_tide_x.selfdecrypt`
>
> Do **not** create `encrypt` or `decrypt` roles. Do **not** wire Forseti contracts. Do **not** call `IAMService.doEncrypt` with a `policyBytes` argument — that's the policy-governed branch and is wrong for this scenario.
>
> ---
>
> ### Team sequence
>
> 1. **Scenario Resolver** — confirm `encrypted-communication`, fresh app, hybrid (Tide for key storage + WebCrypto for runtime).
> 2. **Setup / Platform Engineer** — bootstrap TideCloak via `npm run init` (must be wired to do everything in one shot — see "init script requirements" below).
> 3. **Application Engineer** — Next.js scaffold, SDK install, provider with DPoP, redirect handler, CSP, KeysProvider that lazy-self-decrypts the private key on first use.
> 4. **Security Engineer** — JWT verification on every API route returning encrypted material; never trust client `userId`; rate-limit message POSTs.
> 5. **IAM / Policy Engineer** — `_tide_x.selfencrypt` and `_tide_x.selfdecrypt` in the default composite; verify they appear in the JWT after IGA commit.
> 6. **Reviewer / QA Engineer** — go through the acceptance criteria below before claiming done.
>
> ---
>
> ### Init script requirements (`npm run init`)
>
> The script in `scripts/init.mjs` must do all of this in order, idempotently, and exit non-zero if any step fails. **Everything runs locally** — no cloud accounts, no external services. **Auto-install every prerequisite the script can install** so the user runs one command and walks away.
>
> **Auto-install pass (do this first, before any check):**
> 1. Detect the OS (`process.platform`): `linux`, `darwin`, `win32`.
> 2. **Supabase CLI** — add to `package.json` as a dev dependency (`supabase`) so `npm install` already brought it in. Use `npx supabase` everywhere; never assume a global install.
> 3. **jq** — required by the TideCloak playbooks. If missing:
>    - macOS: `brew install jq` (check `brew --version` first).
>    - Linux (apt): `sudo apt-get update && sudo apt-get install -y jq` — but only if running with `sudo` available. Otherwise print the apt command and exit non-zero with a clear message.
>    - Linux (no apt): try `dnf install -y jq` then `pacman -S --noconfirm jq`.
>    - Windows: `winget install jqlang.jq` (or `choco install jq -y`).
> 4. **Docker** — cannot be auto-installed silently (needs admin + reboot on most systems). Detect; if missing, print a one-paragraph platform-specific install card linking to Docker Desktop / `apt-get install docker.io` and exit non-zero. Do NOT prompt the user mid-script — fail loud.
> 5. **Prisma CLI** — already a dev dep via `prisma` package; no extra step.
> 6. After the auto-install pass, re-verify each binary: `docker --version`, `npx supabase --version`, `jq --version`, `curl --version`. Any failure → exit with the install hint and a non-zero code.
>
> **Bootstrap pass (only after prereqs verified):**
> 7. If `supabase/config.toml` doesn't exist: `npx supabase init`.
> 8. `npx supabase start` — this brings up Postgres (`54322`), REST (`54321`), Realtime (`54321/realtime/v1`), Studio UI (`54323`). Parse the CLI's output for the `anon key` and `service_role key`.
> 9. Write `.env.local` (only fields not already present):
>    - `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`
>    - `DIRECT_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`
>    - `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`
>    - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<anon key>`
> 10. Start the TideCloak container (`start-tidecloak-dev` playbook).
> 11. Wait for `http://localhost:8080` to return 200.
> 12. Create the realm from template (`bootstrap-realm-from-template`) — licensing + IGA + the three E2EE roles.
> 13. Create the admin user, print the invite link, **block until the user opens it and links their Tide account** (poll TideCloak admin API), then commit initial change requests + sign IDP settings (`initialize-admin-and-link-account`).
> 14. Export `data/tidecloak.json` with `jwk`, `vendorId`, `homeOrkUrl`.
> 15. `npx prisma generate && npx prisma db push` against the local Postgres.
> 16. Drop a marker file `data/.bootstrapped` so the next `npm run init` short-circuits.
> 17. Print a "ready" banner with: TideCloak admin URL (`http://localhost:8080`), Supabase Studio (`http://127.0.0.1:54323`), and the next step (`npm run dev`).
>
> **Idempotency rules:**
> - Re-running `npm run init` on a bootstrapped project must be a no-op. Use `data/.bootstrapped` plus `npx supabase status` and `docker ps --filter name=tidecloak` to detect the running state.
> - Provide `npm run init:reset` that tears everything down: `npx supabase stop`, `docker stop tidecloak && docker rm tidecloak`, delete `data/.bootstrapped`, delete `.env.local`. Useful when the dev wants a clean slate.
> - Provide `npm run dev:up` that just starts already-bootstrapped services without re-running the realm bootstrap (`supabase start` + `docker start tidecloak`).
>
> **Output style:**
> - Use a small ANSI-colored step indicator: `[1/17] Installing jq…`. Each step prints what it's doing, what it'd cost to re-run, and the duration.
> - On any failure, print exactly which step failed, the exact command, the captured stderr, and the next thing to try.
>
> ---
>
> ### Package versions
>
> 1. `npm view @tidecloak/nextjs version` → pin **exact** version (no `^`, no `latest`). Skip 0.99.x — fall back to highest non-0.99.x.
> 2. `npm view next version` → caret range. Match React + React DOM majors.
> 3. `@supabase/supabase-js` — caret range, latest stable.
> 4. `prisma` + `@prisma/client` must be the same exact version. Use the latest stable.
> 5. `supabase` (the CLI) as a **dev dependency** — caret range, latest stable. The init script invokes it via `npx supabase` so users don't need a global install.
> 6. Do **not** use `--force` or `--legacy-peer-deps`. Resolve peer conflicts by aligning versions.
> 7. After `package.json` is written, print a one-paragraph version-selection summary.
>
> ---
>
> ### Database + Realtime (local)
>
> - **Postgres + Realtime run locally in Docker via the Supabase CLI.** The whole Supabase stack (Postgres on `54322`, REST on `54321`, Realtime on `54321/realtime/v1`, Studio UI on `54323`) is brought up by one `supabase start` command. No cloud account, no signup.
> - First time: `supabase init` writes `supabase/config.toml`. The init script does this if the file doesn't exist.
> - The local Postgres password is always `postgres`. Use it in `DATABASE_URL` and `DIRECT_URL`. They can both point at the same local URL — no pooler distinction needed locally.
> - The Supabase CLI prints anon + service_role keys at the end of `supabase start`; the init script must capture these and write them to `.env.local`.
> - Add a `prisma/schema.prisma` `directUrl` field anyway. It's harmless locally and makes a future hosted deploy a one-line env-var swap.
> - Realtime works out of the box on the local stack — same `@supabase/supabase-js` client code, just pointed at `http://127.0.0.1:54321`.
>
> ### Optional: deploying to a host later
>
> If the user later wants to deploy:
> - Hosted Supabase: swap `DATABASE_URL` to the **pooler** URL (`aws-1-<region>.pooler.supabase.com:6543`) — direct hosts are IPv6-only and break on WSL2 / many CI runners. Keep `directUrl` pointing at the direct host on port 5432 for migrations.
> - Vercel: pin the deploy region in `vercel.json` to match the Supabase project region (e.g. `"regions": ["syd1"]` for ap-southeast-2). Cross-region adds 300-400ms per query.
> - Pushing env vars to Vercel: use the REST API (`POST https://api.vercel.com/v10/projects/<id>/env` with the token from `~/.local/share/com.vercel.cli/auth.json`). The Vercel CLI silently drops stdin in `vercel env add` and reports success on empty values.
>
> ---
>
> ### Known bugs to avoid (every one of these bit us — do not repeat)
>
> **Auth & identity**
> 1. **`/api/users/me` upserting on every GET clobbers user edits.** The handler must only seed `displayName` / `avatarUrl` from the JWT at user-create time. On subsequent GETs, only update `status`. Otherwise every page load reverts the user's profile edits.
> 2. **Invite-link login loop.** The invite page must check `isInitializing` from `useTideCloak()` before any redirect. Without it, the SDK redirects to `/login` on the first render before auth resolves, and you ping-pong between `/invite/<code>` and `/login?returnUrl=/invite/<code>`.
>
> **E2EE plumbing**
> 3. **`unwrapEpochWithPrivate` "key is not extractable".** When you derive an AES-GCM key via ECDH-ES for the *unwrap* path, import the resulting key with `extractable: true`. The owner's "Grant access" flow needs `exportKey` to re-wrap for new members.
> 4. **Stale `encryptedPrivateKey` rows break decrypt forever.** The TideCloak SDK is picky about bytes vs strings — older app versions stored one and newer expects the other. Ship a "Reset E2EE keys" button in user settings: deletes the row and the user re-bootstraps next login.
> 5. **DM `every` Prisma query matches single-member channels.** Querying for "exactly these two users" with `members: { every: { userId: { in: [a, b] } } }` returns DMs that have only one member. Use `AND: [ { some: { userId: a } }, { some: { userId: b } }, { every: { userId: { in: [a, b] } } } ]` AND assert `members.length === 2` after the query.
>
> **Supabase Realtime**
> 6. **"cannot add presence callbacks after subscribe".** `supabase.channel(topic)` returns the **same** RealtimeChannel instance for the same topic. If two hooks (e.g. one that signals voice and one that observes voice rosters) both call `client.channel('voice:<id>')`, the second one's `.on()` calls fail because the first has already subscribed. Fix: use a **module-level singleton** that owns one channel per topic and exposes `track()` + `subscribe()` to listeners. See `lib/voiceRoster.ts`-style pattern.
> 7. **Channel switch shows previous channel's chat for a flash.** Add `key={channel.id}` to `ChatArea` and `VoiceRoom` so React remounts on switch, and synchronously reset local state on `channelId` change (do not wait for the fetch).
> 8. **Sidebar shows the old server's channels after switching servers.** The local channel-list state must `useEffect([server?.id, server?.channels])` to re-seed every time, not only when the list is empty.
>
> **Voice / video**
> 9. **"I see only myself, no audio."** The `<video>` element must be **mounted whenever a stream is present**, not gated on `hasVideo`. Audio-only peers have no video tracks but still need an element to play their audio. CSS-hide it when there's no video; never unmount.
> 10. **Screen share stuck after browser-stop.** Don't put the swap-back logic only behind a button click. Extract `swapBackToCamera()` and call it from BOTH the toggle button AND `screenTrack.onended`. Clear `screenTrack.onended` after firing once.
> 11. **NAT-traversal failures with no error.** Default ICE servers are not enough. Configure `openrelay.metered.ca` (or another public TURN) on every `RTCPeerConnection`.
>
> **Routing / UX**
> 12. **Clicking a server icon doesn't navigate.** The rail must `router.push("/channels/<id>/<firstChannelId>")` — not just call `setActiveServer`. Otherwise the URL stays on the previous channel and the user thinks switching is broken.
> 13. **Live profile updates don't propagate.** When user edits their displayName/avatar/accent, fire `window.dispatchEvent(new CustomEvent("zl:profile-saved"))`. AppShell + FriendsPanel listen and re-fetch.
>
> ---
>
> ### Build sequence (follow playbooks in order)
>
> 1. `start-tidecloak-dev` — Docker container.
> 2. `bootstrap-realm-from-template` — realm + licensing + IGA + the three roles.
> 3. `initialize-admin-and-link-account` — admin user, invite link, link Tide, commit, sign IDP, export `tidecloak.json`.
> 4. `configure-e2ee-roles-and-policies` — wire the `_tide_x.selfencrypt` / `_tide_x.selfdecrypt` roles into the default composite.
> 5. `add-auth-nextjs-fresh` — SDK install, `TideCloakProvider` with **DPoP enabled**, redirect handler at `/auth/redirect/page.tsx`, `silent-check-sso.html`, CSP.
> 6. `protect-routes-nextjs` — UI gating only.
> 7. `protect-api-nextjs` + `verify-jwt-server-side` — every API route that returns user/channel data verifies JWT server-side; reject without DPoP proof if DPoP is enabled.
> 8. `add-rbac-nextjs` (E2EE section) — `KeysProvider` lazy-decrypts the private key on first use; UI surfaces "Awaiting key" / "Mint key" / "Grant access" states for the owner.
>
> ---
>
> ### Feature surface — pack the playbooks must end up producing
>
> Build incrementally; each bullet is a deploy-able milestone.
>
> **Auth + bootstrap**
> - TideCloak login + DPoP, JWT-verified APIs, redirect handler, CSP.
> - User record auto-created on first `GET /api/users/me`. **Do not overwrite displayName/avatarUrl on subsequent GETs.**
> - User keypair: ECDH P-256, public key stored as base64 SPKI-DER, private key stored as TideCloak-self-encrypted PKCS8-DER ciphertext.
>
> **Servers + channels**
> - Server with `ownerId`, member list, invite code.
> - Text + voice channels, optional `ChannelCategory` (collapsible groups).
> - Channel `description` (topic), `position` (drag-reorder), per-channel mute (localStorage).
> - Server icon upload (data URL, ≤96 KB after canvas resize).
> - "Mute server" toggle that walks every channel id.
> - Server settings modal (rename, leave, mute server, delete).
>
> **Messaging (E2EE)**
> - Per-server epoch key wrapped per-member via ECDH-ES + HKDF + AES-GCM (`ServerKey` table keyed by `(serverId, userId, version)`).
> - Owner-only "Grant access" flow re-wraps the current epoch for any joiner missing a wrap.
> - Messages: AES-GCM-256 over `iv(12) || ciphertext`, base64 in `Message.content`. Schema field `keyVersion` survives epoch rotation.
> - Plaintext metadata in `Message`: `mentions: String[]`, `isPinned`, `pinnedAt` — server reads these for routing/notifications without seeing message content.
>
> **DMs**
> - 1:1 DMs: ECDH(myPriv, theirPub) → AES-GCM key. No wrap, no rotation.
> - Group DMs (3-9 members): channel-id-derived AES key as stop-gap, **clearly labeled "Transport-only"** in the header. Per-member wraps are TODO.
> - Friends list (PENDING / ACCEPTED), add by username.
> - Right-click DM → mute / close (DELETE only the caller's `ChannelMember` row).
>
> **Voice**
> - Per-channel Supabase Realtime presence channel `voice:<id>` for signaling (offer/answer/ICE) AND a separate **module-level singleton** `voice-roster:v1` topic for who's-in-voice display (fixes the topic-collision bug).
> - WebRTC mesh, DTLS-SRTP, **HMAC-signed SDP** using a key derived from the server epoch (so the server can't silently MITM).
> - Self + peer speaking detection (analyser node for self, `inbound-rtp.audioLevel` for peers).
> - Push-to-talk (Shift+Space outside inputs), voice ducking (35% remote volume while self speaking), voice quality pip per peer (RTT-driven), voice join/leave ding.
> - Public TURN configured (`openrelay.metered.ca`).
> - `<video>` always mounted when stream exists (CSS-hidden if no video) so audio-only peers play.
>
> **Discord-feel UX**
> - Reactions (with users tooltip), replies (auto-mention original author, click to jump), edit/delete, pins (drawer with "Jump"), mentions with browser notification + audio ping, mention highlight (yellow border) on @-of-me messages, `@everyone` / `@here` expansion at send time.
> - Slash commands `/me /shrug /tableflip /unflip /spoiler /code` (transform plaintext before encrypt).
> - Markdown: `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, ```` ```fenced``` ```` with syntax highlighting (DIY tokenizer for js/ts/py/json/sh/sql), `# H1` / `## H2` / `### H3`, `> blockquote`, `- bullet` / `1. ordered` lists, `||spoiler||`, `[label](url)`, `<t:UNIX:STYLE>` Discord-style timestamps, `| pipe | tables |`.
> - Composer: `:emoji:` shortcode autocomplete, `@username` autocomplete, slash-command autocomplete, paste-image, drag-drop multi-file upload, Up-arrow edits last own message.
> - Quick switcher (Ctrl/Cmd+K) over channels + DMs.
> - Read marker ("New" divider), in-channel search, scroll-to-bottom button, date dividers, friendly timestamps, tab-title mention badge.
> - Inline image grid (1 / 2-col / 3-col), lightbox.
> - Profile popover with bio / pronouns / accent banner / member-since; clicking a member, message author, or `@username` opens it. "Send Message" button creates a DM (works for offline users).
> - Avatar upload (data URL, square crop, ≤96 KB).
> - Custom status text broadcast via Supabase Presence.
> - Right-click message: Reply, React, Edit, Pin, Forward, Copy Text, Copy Message Link (`#msg-<id>` deep link), Copy ID, Mark Unread, View Profile, Delete, Save Message (localStorage bookmarks, "Saved Messages" pseudo-channel under Friends).
> - Server rail: drag-reorder (localStorage), per-server unread pip + mention count badge, hover tooltip, custom server icon.
> - Toast layer (`showToast()`) for clipboard / save / mute feedback.
>
> ---
>
> ### Don't
>
> - Don't create fake auth helpers or plain-text role cookies.
> - Don't treat `hasRole()` or route guards as real API protection — every API that returns user data must verify the JWT server-side.
> - Don't store any plaintext message content on the server. Don't log decrypted plaintext.
> - Don't use Forseti / VVK / `policyBytes` for any flow in this app.
> - Don't try to share Supabase Realtime topics across hooks without a singleton wrapper.
> - Don't ship `vercel env add` automation — use the REST API directly.
> - Don't pin `@tidecloak/*` packages to `latest` or `^`.
>
> ---
>
> ## Acceptance Criteria
>
> - [ ] `npm install && npm run init` from a clean checkout brings up the local Supabase stack (Postgres + Realtime + Studio in Docker), starts TideCloak, creates the realm, exports adapter JSON, writes `.env.local`, runs `prisma db push`, and prints the next-step banner — without any manual file edits and without any cloud signup.
> - [ ] If `jq` is missing, `npm run init` auto-installs it via the platform package manager (or fails loud with the exact install command if no admin available).
> - [ ] If Docker is missing, `npm run init` prints a platform-specific install card and exits non-zero (Docker can't be auto-installed silently).
> - [ ] Re-running `npm run init` is a no-op (uses `data/.bootstrapped` + `supabase status` + `docker ps` to skip completed steps).
> - [ ] `npm run init:reset` tears everything down (`supabase stop`, stop TideCloak container, delete marker + `.env.local`).
> - [ ] `npm run dev:up` starts already-bootstrapped services without re-running the realm bootstrap.
> - [ ] Login redirects to TideCloak and back; DPoP is enabled; `silent-check-sso.html` is in `public/`.
> - [ ] `_tide_x.selfencrypt` and `_tide_x.selfdecrypt` appear in the JWT after IGA commit.
> - [ ] First login generates an ECDH P-256 keypair; private key is stored Tide-self-encrypted; public key in plain DER.
> - [ ] Owner creates a server → epoch key wrapped for self → can post + decrypt messages.
> - [ ] Invited member's "Awaiting key" state clears after owner clicks "Grant access" (epoch re-wrapped via ECDH-ES).
> - [ ] Editing display name + avatar persists across page reloads (no JWT clobber bug).
> - [ ] Switching channels does not show the previous channel's messages even for a frame.
> - [ ] Switching servers updates the channel sidebar.
> - [ ] Voice: two browsers join a voice channel and hear each other within 5 seconds. No "cannot add presence callbacks" console error. Camera + screen share both work; stopping screen share via the browser bar restores the camera.
> - [ ] Vercel deploy region matches the Supabase region (single-region p99 < 200ms for `/api/servers`).
> - [ ] Unauthenticated `curl` to any data API returns 401.
> - [ ] `useUnreadListener`, voice signaling, and voice-roster all run in the same tab without colliding on Supabase channel topics.

---

## Reference: scenario manifest to follow

`reference-apps/encrypted-communication/manifest.yaml` — read it. Roles, default composite, playbook order, and bootstrap requirements come from there. Your build must match its `roles` and `playbook_sequence` exactly.
