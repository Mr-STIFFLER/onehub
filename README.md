# ONEHUB

Gamer-first voice and chat that you host yourself. This is the **core beta**: the foundation every later feature in the 242-item catalog builds on.

## What works today

| Area | Included |
| --- | --- |
| Accounts | Register, sign in, profiles (display name, status, bio, colour), first account becomes instance admin |
| Communities | Create, invite links (expiry), join, leave, delete, ownership transfer, default channels |
| Channels | Text, voice and announcement channels in categories; create, rename, delete |
| Messaging | Real-time chat, edit, delete, history paging, typing indicators, @mentions, safe Markdown (bold, italic, code, quotes, links) |
| Direct messages | One-to-one conversations with live delivery |
| Roles & permissions | 13 permission flags, role colours, role hierarchy, no granting what you don't hold, @everyone defaults |
| Voice & video | LiveKit (Opus, WebRTC SFU): join/leave, mute, deafen, speaking indicator, per-person volume, camera, screen share with audio, device selection, noise suppression |
| Safety | Report messages/users, block, kick, ban with rank checks, moderator report queue, audit log, rate limits |
| Admin | Instance control room: live stats, all reports, disable accounts |
| Desktop | Tauri 2 shell for Windows: tray icon, close-to-tray, single instance, NSIS/MSI installers |

**Not in this beta:** everything in catalog phases P2–P4 (streams, tournaments, forums, payments, AI, bots, E2EE, federation), file uploads, mobile apps, push notifications, auto-update.

## Architecture

```
client/   React + Vite + Tailwind (web UI, also bundled into the desktop app)
desktop/  Tauri 2 wrapper → Windows installer
server/   Fastify + PostgreSQL + WebSocket gateway, issues LiveKit voice tokens
LiveKit   separate media server for voice/video/screen share
```

The voice library is loaded only when someone joins a voice room, so the idle client stays light during gameplay.

## Run it locally

Requirements: Node 22, pnpm 10, PostgreSQL 16, and the [LiveKit server binary](https://github.com/livekit/livekit/releases) for voice.

```bash
pnpm install
createdb onehub                       # or use the docker-compose db
livekit-server --dev                  # voice, keys devkey / secret

# terminal 1
cd server
LIVEKIT_URL=ws://localhost:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret pnpm dev

# terminal 2
pnpm dev:client                       # http://localhost:5173
```

Defaults expect `postgres://onehub:onehub@localhost:5432/onehub`; override with `DATABASE_URL`.

## Tests

```bash
pnpm test        # API integration tests against a real Postgres
pnpm typecheck
```

## Production

A laptop is fine for development and a private beta with friends. For anything public, run this on a VPS: voice and video need stable upload bandwidth and open UDP ports.

```bash
cp .env.example .env    # fill in every value
docker compose up -d
```

Put HTTPS in front of port 4000 (app) and 7880 (LiveKit signalling), and open UDP 50000–60000 plus TCP 7881 for media.

## Windows installer

CI builds it on every push (`.github/workflows/ci.yml` → `windows-installer` artifact). To build by hand on Windows:

```bash
pnpm install
pnpm --dir desktop build   # → desktop/src-tauri/target/release/bundle/
```

The desktop app asks for the server address on first sign-in. Code signing and auto-update need your own certificate and signing key before a public release.
