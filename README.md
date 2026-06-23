# Spectral Front

Spectral Front is a small tactical artillery game built with Next.js. Each player plots a function `y = f(x)` from a selected ship’s local origin, trying to hit the opposing fleet while planets block the trajectory.

It supports two match modes:

- **Live match** — anonymous, peer-to-peer 1v1 play. Redis coordinates matchmaking and WebRTC signaling; the match state travels over a WebRTC data channel.
- **Bot training** — an immediate, local match against a basic tactical bot. It does not use Redis, signaling, or WebRTC.

## Run locally

Install dependencies and start the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Bot training works without any service configuration. Live matches require the Upstash Redis variables below.

## Environment

For live matchmaking and signaling, configure:

```bash
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

The WebRTC configuration currently includes Google’s public STUN server. TURN is intentionally not configured, so some restrictive networks will be unable to establish a live peer-to-peer connection.

## Commands

```bash
npm run dev    # Start the Next.js development server
npm run build  # Create and type-check a production build
npm run start  # Serve a production build
```

## Game rules

- Each fleet has three ships; the host/player starts.
- Select a surviving ship, then enter a permitted mathematical expression for `y = f(x)`.
- The selected ship is `(0, 0)` in the expression’s local coordinate system.
- A trajectory ends when it leaves the game world or reaches a planet or asteroid. A direct hit destroys one ship.
- A malformed or unstable function loses the turn.
- The first side with no surviving ships loses.
- Every match generates a new board: each fleet spawns at random, separated positions inside its own third; two to six planets and a separated asteroid field are placed with enforced clearances. A bounded shared planet-volume budget means sparse boards have larger worlds while dense boards have smaller ones, with deliberately wide per-planet variation so a giant can coexist with much smaller bodies. Planets may enter each side’s territory, but remain at least three ship lengths from every ship.

The expression parser is deliberately limited. It accepts numbers, `x`, `pi`, parentheses, `+`, `-`, `*`, `/`, `^`, and `sin`, `cos`, `tan`, `abs`, `sqrt`, `log`, and `exp`; it never evaluates submitted JavaScript.

## Architecture

### Match controller

[`app/match/[matchId]/game-client.js`](app/match/[matchId]/game-client.js) owns UI state, match startup, peer transport, and turn orchestration. It does not contain geometry or canvas rendering logic.

### Game model

[`app/match/[matchId]/game-model.js`](app/match/[matchId]/game-model.js) is a pure simulation module. It defines the fixed world dimensions, generates valid fleet and planet placements, traces expressions, resolves shots, advances turns, and selects basic bot shots. The same model is used for local and live matches.

### Arena renderer

[`app/match/[matchId]/arena-canvas.js`](app/match/[matchId]/arena-canvas.js) is the only module that draws the arena. It observes the stable CSS viewport, not the canvas element, and creates a device-pixel-ratio-aware backing buffer. World coordinates are scaled into that buffer at draw time. Planet texture seeds and types (`earthlike`, `marslike`, `venuslike`, `ice`, and `gas`) are part of match state, so both live peers see the same procedural worlds.

The arena viewport has a fixed 5:3 aspect ratio. On ultrawide layouts it remains centered with side space instead of stretching the game world.

### Live transport

- [`app/api/join/route.js`](app/api/join/route.js) atomically pairs lobby tickets in Redis.
- [`app/api/signal/route.js`](app/api/signal/route.js) relays short-lived WebRTC offer, answer, ICE candidate, and leave messages.
- [`app/api/ice/route.js`](app/api/ice/route.js) returns the client ICE configuration for a matched ticket.

The live-match host resolves gameplay state. This is appropriate for casual play; it is not designed for ranked, competitive, or economic use.

## Deploy to Vercel

1. Import the repository into Vercel.
2. Create or connect an Upstash Redis database.
3. Add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to the Vercel project environment.
4. Deploy.

## Current boundaries

- One anonymous live queue; waiting tickets expire after 90 seconds.
- No accounts, persistence, matchmaking rating, reconnect flow, or spectating.
- TURN is not configured.
- The bot is intentionally simple: it searches for a clear direct arc rather than planning multi-turn strategy.
