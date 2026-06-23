# Spectral Front

Spectral Front is a small tactical artillery game built with Next.js. Each player plots a function `y = f(x)` from a selected ship’s local origin, trying to hit the opposing fleet while planets block the trajectory. Combat is **live and simultaneous**: both sides manage energy, move ships, and fire whenever they can afford it.

It supports two match modes:

- **Live match** — anonymous, peer-to-peer 1v1 play. Choose the public queue or create/join a private lobby with a six-character code. Redis coordinates pairing and WebRTC signaling; the match state travels over a WebRTC data channel.
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

### Live combat

- There are **no turns**. Both players act at the same time, limited only by energy and match state.
- Every match begins with a synchronized **12-second staging countdown**. Ships spawn with zero energy; weapons and movement are locked until the launch signal, then energy begins regenerating.
- Each player has a shared **energy pool** (100 max, regenerates at **4/sec**). In bot training, the bot pool regenerates at **2/sec**.
- Firing and movement both consume energy. You can fire again immediately after a shot as long as you have enough energy — beam animations are visual only and do not lock input.

### Firing

- Select a surviving ship, enter a permitted mathematical expression for `y = f(x)`, and set **beam power** (5–100%).
- The selected ship is `(0, 0)` in the expression’s local coordinate system.
- Constant vertical offsets are normalized away, so every trajectory begins at its selected ship even when the entered function contains a constant term.
- Every background grid square is **one graph unit**. The selected ship is the graph origin, so the hover readout, `x`, and `y` in an expression all use the same scale.
- **Power sets range and cost**: beam travel distance is `power × 0.8` graph units along the traced arc; energy cost is `6 + (power / 100) × 54`.
- A dotted **trajectory preview** shows the first portion of the current arc from the selected ship.
- A trajectory stops at planets and their orbiting moons, destroys asteroids on contact, and destroys one ship on a direct hit. Collisions resolve **immediately** when the shot is fired.
- If the beam reaches its power limit with no collision, the notification reads **“Beam range exhausted.”** If the curve leaves the sector before that limit, it reads **“Beam exits the sector.”**
- A malformed or unstable function is rejected with no energy cost.
- Shots render as timed laser pulses at constant travel speed (~2400 world units/sec). The head follows arc length (not sample count), fades toward its range limit, and leaves a luminous tail. Impact blooms appear when the animated head reaches the impact point.

### Movement

- With a ship selected, **click space** to set a waypoint. The ship accelerates smoothly toward it, rotates to face travel direction, and decelerates into arrival without snapping to the destination.
- **Click again while moving** to cancel — the ship brakes to a stop at its current position.
- Movement costs **20 energy** to start and **6 energy/sec** while actively moving. If energy runs out mid-route, the ship brakes automatically.
- Waypoints use **straight-line segments**, validated against planets, moons, and asteroids (ships may overlap). There is no pathfinding — only direct, obstacle-checked routes.
- Movement commands are `{ type: 'move', role, shipIndex, x, y }` and `{ type: 'cancelMove', role, shipIndex }`.

### Match outcome

- The first side with no surviving ships loses immediately. The authoritative game state records the winner and `fleet-destroyed` end reason and presents the same win/loss result to both live peers. Bot matches offer a fresh training sector; live matches return both commanders to the lobby.

### Board generation

Every match generates a new board: each fleet spawns at random, separated positions inside its own third; two to six planets and a separated asteroid field are placed with enforced clearances. A bounded shared planet-volume budget creates one or two dominant anchor worlds, with the remaining planets much smaller. Planets may enter each side’s territory, but remain at least three ship lengths from every ship.

### View

- The guest/client view is **mirrored horizontally** so your fleet always appears on the left. Clicks are transformed back to world coordinates before being sent to the host.
- Waypoint lines and planned movement remain **owner-only**. Opponents can see a ship’s live position, heading, and movement, but not its chosen destination or planned route.

The expression parser is deliberately limited. It accepts numbers, `x`, `pi`, parentheses, `+`, `-`, `*`, `/`, `^`, and `sin`, `cos`, `tan`, `abs`, `sqrt`, `log`, `ln`, and `exp`; `ln` is an alias for the natural logarithm. It never evaluates submitted JavaScript.

## Architecture

### Match controller

[`app/match/[matchId]/game-client.js`](app/match/[matchId]/game-client.js) owns UI state, match startup, peer transport, the energy/move/fire command UI, and the host simulation loop. It does not contain geometry or canvas rendering logic.

### Game model

[`app/match/[matchId]/game-model.js`](app/match/[matchId]/game-model.js) is a pure simulation module. It defines the fixed **1000×600** world, generates valid fleet and planet placements, traces expressions, and applies three action types:

| Action | Purpose |
|--------|---------|
| `fire` | Trace arc, deduct energy, apply collisions immediately, append trail/bloom events |
| `move` | Validate segment, deduct initial energy, assign waypoint |
| `cancelMove` | Begin smooth braking |

The host runs `advanceSimulation()` every **50 ms** to regenerate energy and update ship velocity/position. Live guests send actions to the host and receive full state snapshots (including simulation events such as out-of-energy movement stops).

### Arena renderer

[`app/match/[matchId]/arena-canvas.js`](app/match/[matchId]/arena-canvas.js) is the only module that draws the arena. It observes the stable CSS viewport, creates a device-pixel-ratio-aware backing buffer, and scales world coordinates at draw time. It also handles:

- Guest-side **horizontal mirroring**
- Smooth **ship rotation** (display-only, client-interpolated)
- Dotted **trajectory preview** for the selected ship
- Distance-based **beam animation** and range fade

Planet texture seeds and types are part of match state, so both live peers see the same procedural worlds. Laser and impact events carry a stable shot id and deterministic impact data; each renderer starts its visual clock when it receives that event.

Planet appearance follows a size-aware taxonomy: small bodies favor moons, Mercurian, lava, Pluto-like, and rocky worlds; middle sizes favor terrestrial, ocean, ice, super-Earth, and mini-Neptune worlds; the largest worlds favor Neptune/Uranus-like ice giants and Jupiter/Saturn-like gas giants. Large worlds can also carry decorative moonlets and rings.

The arena viewport has a fixed 5:3 aspect ratio. On ultrawide layouts it remains centered with side space instead of stretching the game world.

### Notifications

[`app/match/[matchId]/notification-config.js`](app/match/[matchId]/notification-config.js) defines arena toast messages (hits, range exhausted, path blocked, low energy, movement events, etc.). Toggle any `enabled` flag to suppress a message without changing gameplay.

### Live transport

- [`app/api/join/route.js`](app/api/join/route.js) atomically pairs public-queue tickets and private-lobby codes in Redis. Private codes are six uppercase, unambiguous characters and expire after 10 minutes; public queue tickets expire after 90 seconds.
- [`app/api/signal/route.js`](app/api/signal/route.js) relays short-lived WebRTC offer, answer, ICE candidate, and leave messages.
- [`app/api/ice/route.js`](app/api/ice/route.js) returns the client ICE configuration for a matched ticket.

The live-match host applies all actions, runs the simulation tick, and sends the complete resulting state after every action and tick. That state includes ship positions, energy, destroyed asteroids, ship damage, laser paths, and bloom events. This is appropriate for casual play; it is not designed for ranked, competitive, or economic use.

### Bot AI

The bot plays as **guest** and uses the same energy, movement, and fire rules as a human. It holds fire for the first 10 seconds, then is limited to one shot every 5 seconds. It searches curved functions for obstacle-free shots and, if none exist from its current position, waits for a full energy pool before taking a nearby valid waypoint from which a shot opens up. It has a ~30% chance to take an intentional miss when a direct solution exists.

## Deploy to Vercel

1. Import the repository into Vercel.
2. Create or connect an Upstash Redis database.
3. Add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to the Vercel project environment.
4. Deploy.

## Current boundaries

- One anonymous public live queue (90-second expiry), plus private lobbies with six-character codes (10-minute expiry).
- No accounts, persistence, matchmaking rating, reconnect flow, or spectating.
- TURN is not configured.
- The bot is intentionally simple: it does not plan far ahead or coordinate multiple ships.
- The renderer uses a 1000×600 internal world, but a fixed conversion keeps all player-facing graph distances coherent: **50 world units = one graph unit = one background grid square**.
