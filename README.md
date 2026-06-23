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
- Constant vertical offsets are normalized away, so every trajectory begins at its selected ship even when the entered function contains a constant term.
- A trajectory stops at planets, which remain in play; it destroys asteroids on contact; and a direct hit destroys one ship. Each shot first enters a replicated in-flight state; its collision only changes the board when the beam reaches its endpoint, so asteroid removal, ship destruction, blooms, turn advance, and match completion occur together at impact.
- Shots render as timed laser pulses: the bright head follows the sampled path, leaves a short luminous tail, then fades away on impact. Planet and asteroid impacts create an expanding gray debris burst; destroyed ships add a larger mix of gray hull fragments and fire-colored particles.
- A malformed or unstable function loses the turn.
- The first side with no surviving ships loses immediately. The authoritative game state records the winner and `fleet-destroyed` end reason, closes the turn, rejects any later actions, and presents the same win/loss result to both live peers. Bot matches offer a fresh training sector; live matches return both pilots to the lobby.
- Every match generates a new board: each fleet spawns at random, separated positions inside its own third; two to six planets and a separated asteroid field are placed with enforced clearances. A bounded shared planet-volume budget creates one or two dominant anchor worlds, with the remaining planets much smaller; dense boards therefore read as a few large landmarks surrounded by minor bodies. Planets may enter each side’s territory, but remain at least three ship lengths from every ship.

The expression parser is deliberately limited. It accepts numbers, `x`, `pi`, parentheses, `+`, `-`, `*`, `/`, `^`, and `sin`, `cos`, `tan`, `abs`, `sqrt`, `log`, and `exp`; it never evaluates submitted JavaScript.

## Architecture

### Match controller

[`app/match/[matchId]/game-client.js`](app/match/[matchId]/game-client.js) owns UI state, match startup, peer transport, and turn orchestration. It does not contain geometry or canvas rendering logic.

### Game model

[`app/match/[matchId]/game-model.js`](app/match/[matchId]/game-model.js) is a pure simulation module. It defines the fixed world dimensions, generates valid fleet and planet placements, traces expressions, and applies the single `fire` action accepted by every participant. Firing creates a clock-free `pendingShot`; the host resolves that shared event at the end of its visual flight. The bot only chooses a valid `fire` action; humans, the bot, and the live-match host all use the same action contract and state transition.

### Arena renderer

[`app/match/[matchId]/arena-canvas.js`](app/match/[matchId]/arena-canvas.js) is the only module that draws the arena. It observes the stable CSS viewport, not the canvas element, and creates a device-pixel-ratio-aware backing buffer. World coordinates are scaled into that buffer at draw time. Planet texture seeds and types are part of match state, so both live peers see the same procedural worlds. Impact and laser events contain a stable shot id and deterministic impact data; each renderer starts its visual clock when it receives that event, rather than relying on synchronized wall clocks.

Planet appearance follows a size-aware taxonomy: small bodies favor moons, Mercurian, lava, Pluto-like, and rocky worlds; middle sizes favor terrestrial, ocean, ice, super-Earth, and mini-Neptune worlds; the largest worlds favor Neptune/Uranus-like ice giants and Jupiter/Saturn-like gas giants. Large worlds can also carry decorative moonlets and rings.

The arena viewport has a fixed 5:3 aspect ratio. On ultrawide layouts it remains centered with side space instead of stretching the game world.

### Live transport

- [`app/api/join/route.js`](app/api/join/route.js) atomically pairs lobby tickets in Redis.
- [`app/api/signal/route.js`](app/api/signal/route.js) relays short-lived WebRTC offer, answer, ICE candidate, and leave messages.
- [`app/api/ice/route.js`](app/api/ice/route.js) returns the client ICE configuration for a matched ticket.

The live-match host resolves gameplay state and sends the complete resulting state after every action. That state includes destroyed asteroids, ship damage, laser paths, and planet/asteroid/ship bloom events. This is appropriate for casual play; it is not designed for ranked, competitive, or economic use.

## Deploy to Vercel

1. Import the repository into Vercel.
2. Create or connect an Upstash Redis database.
3. Add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to the Vercel project environment.
4. Deploy.

## Current boundaries

- One anonymous live queue; waiting tickets expire after 90 seconds.
- No accounts, persistence, matchmaking rating, reconnect flow, or spectating.
- TURN is not configured.
- The bot is intentionally simple and does not plan multiple turns ahead.
- The bot randomly selects a live ship and target, searches a small family of curved functions for an obstacle-free route, then has a 30% chance to submit that connecting `fire` action; otherwise it submits a randomized miss action.
