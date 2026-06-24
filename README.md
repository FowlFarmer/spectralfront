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

The WebRTC configuration always includes a public STUN server. When Metered TURN variables are configured, the authenticated ICE endpoint also fetches Metered’s ICE-server array and offers TURN as an automatic relay fallback. WebRTC still prefers a direct peer-to-peer path.

### Metered TURN on Vercel

1. In Metered, create a TURN credential. In **Dashboard → Developers**, copy the Metered domain (for example, `your-app.metered.live`) and the credential’s API key. Metered’s credential endpoint returns the complete STUN/TURN ICE-server array.
2. In Vercel, open **Project → Settings → Environment Variables** and add these values to **Production** (and Preview if you want preview deployments to support live matches):

   ```bash
   METERED_TURN_DOMAIN=your-app.metered.live
   METERED_TURN_API_KEY=your-metered-credential-api-key
   METERED_TURN_REGION=global
   ```

   `METERED_TURN_REGION` is optional; omit it to use Metered’s configured default. Do not use a `NEXT_PUBLIC_` prefix for either secret.
3. Redeploy the Vercel project. A matched player then requests `/api/ice`; that endpoint validates the match ticket before returning the Metered relay credentials to the browser.

If you only have the dashboard’s static username/password and ICE array, this alternate configuration also works. Put the TURN URLs from Metered’s shown ICE array into one comma-separated value; do not include its STUN entry because the app already provides a STUN fallback.

```bash
METERED_TURN_URLS=turn:standard.relay.metered.ca:80,turn:standard.relay.metered.ca:80?transport=tcp,turn:standard.relay.metered.ca:443,turns:standard.relay.metered.ca:443?transport=tcp
METERED_TURN_USERNAME=replace-with-a-rotated-username
METERED_TURN_CREDENTIAL=replace-with-a-rotated-password
```

Use either the API-key configuration or this static-credential configuration—not both. The API-key path takes precedence when both exist. For local live-match testing, put the selected configuration in `.env.local`. If Metered is not configured or temporarily unavailable, the app remains STUN-only rather than blocking a match.

## Commands

```bash
npm run dev    # Start the Next.js development server
npm run build  # Create and type-check a production build
npm run start  # Serve a production build
```

## Game rules

### Live combat

- There are **no turns**. Both players act at the same time, limited only by energy and match state.
- Every match begins with a synchronized **5-second staging countdown**. Ships spawn with zero energy; weapons and movement are locked until the launch signal, then energy begins regenerating.
- Every surviving ship owns its own **energy pool** (100 max, regenerates at **2/sec**). Firing and movement only spend the selected ship’s energy; the bot follows the same per-ship rule.
- Firing and movement both consume energy. You can fire again immediately after a shot as long as you have enough energy — beam animations are visual only and do not lock input.

### Firing

- Select a surviving ship, enter a permitted mathematical expression for `y = f(x)`, and set **beam power** (5–100%).
- The selected ship is `(0, 0)` in the expression’s local coordinate system.
- Constant vertical offsets are normalized away, so every trajectory begins at its selected ship even when the entered function contains a constant term.
- Every background grid square is **one graph unit**. The selected ship is the graph origin, so the hover readout, `x`, and `y` in an expression all use the same scale.
- **Power sets range and cost**: beam travel distance is `power × 0.8` graph units along the traced arc; energy cost scales linearly from **25** at 5% power to **100** at 100% power.
- A dotted **trajectory preview** shows the first portion of the current arc from the selected ship.
- A trajectory stops at planets and their orbiting moons, destroys asteroids on contact, and destroys one ship on a direct hit. Collisions resolve **immediately** when the shot is fired.
- If the beam reaches its power limit with no collision, the notification reads **“Beam range exhausted.”** If the curve leaves the sector before that limit, it reads **“Beam exits the sector.”**
- A malformed or unstable function is rejected with no energy cost.
- Shots render as timed laser pulses at constant travel speed (~2400 world units/sec). The head follows arc length (not sample count), fades toward its range limit, and leaves a luminous tail. Impact blooms appear when the animated head reaches the impact point.

### Movement

- With a ship selected, **click space** to set a waypoint. The ship accelerates smoothly toward it, rotates to face travel direction, and decelerates into arrival without snapping to the destination.
- **Click again while moving** to cancel — the ship brakes to a stop at its current position.
- Movement costs the selected ship **25 energy** to start and **3 energy/sec** while actively moving. If that ship runs out mid-route, it brakes automatically.
- Waypoints use **straight-line segments**, validated against planets, moons, and asteroids (ships may overlap). There is no pathfinding — only direct, obstacle-checked routes.
- Movement commands are `{ type: 'move', role, shipIndex, x, y }` and `{ type: 'cancelMove', role, shipIndex }`.

### Match outcome

- The first side with no surviving ships loses. The win/loss screen appears **2 seconds** after the final ship is destroyed; combat locks immediately when a fleet is wiped. The authoritative game state records the winner and `fleet-destroyed` end reason and presents the same result to both live peers. Bot matches offer a fresh training sector; live matches return both commanders to the lobby.

### Board generation

Every match generates a new board: each fleet spawns as four random, separated ships inside its own third; two to six planets and a separated asteroid field are placed with enforced clearances. A bounded shared planet-volume budget creates one or two dominant anchor worlds, with the remaining planets much smaller. Planets may enter each side’s territory, but remain at least three ship lengths from every ship.

### View

- The guest/client view is **mirrored horizontally** so your fleet always appears on the left. Clicks are transformed back to world coordinates before being sent to the host.
- Graph coordinates are local to the selected ship for both commanders: positive `x` always points toward the opposing side of the displayed arena, and positive `y` points upward. The host applies the guest’s action as `role: 'guest'`, then projects that same local graph into leftward world space.
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

The host runs `advanceSimulation()` every **50 ms** to regenerate energy and update ship velocity/position. Live guests send literal fire/move actions to the host and receive authoritative state snapshots (including simulation events such as out-of-energy movement stops).

### Arena renderer

[`app/match/[matchId]/arena-canvas.js`](app/match/[matchId]/arena-canvas.js) is the only module that draws the arena. It observes the stable CSS viewport, creates a device-pixel-ratio-aware backing buffer, and scales world coordinates at draw time. It also handles:

- Guest-side **horizontal mirroring**
- Smooth **ship rotation** (display-only, client-interpolated)
- Dotted **trajectory preview** for the selected ship
- Distance-based **beam animation** and range fade

Planet texture seeds and types are part of match state, so both live peers see the same procedural worlds. Laser events carry a stable shot id, literal expression, frozen firing origin, range, and deterministic impact data—but never sampled trajectory points. Each renderer recreates the beam locally, clips it to the authoritative endpoint, and starts its visual clock when it receives that event.

Planet appearance follows a size-aware taxonomy: small bodies favor moons, Mercurian, lava, Pluto-like, and rocky worlds; middle sizes favor terrestrial, ocean, ice, super-Earth, and mini-Neptune worlds; the largest worlds favor Neptune/Uranus-like ice giants and Jupiter/Saturn-like gas giants. Large worlds can also carry decorative moonlets and rings.

The arena viewport has a fixed 5:3 aspect ratio. On ultrawide layouts it remains centered with side space instead of stretching the game world.

### Notifications

[`app/match/[matchId]/notification-config.js`](app/match/[matchId]/notification-config.js) defines arena toast messages (hits, range exhausted, path blocked, low energy, movement events, etc.). Toggle any `enabled` flag to suppress a message without changing gameplay.

### Live transport

- [`app/api/join/route.js`](app/api/join/route.js) atomically pairs public-queue tickets and private-lobby codes in Redis. Private codes are six uppercase, unambiguous characters and expire after 10 minutes; public queue tickets expire after 90 seconds.
- [`app/api/signal/route.js`](app/api/signal/route.js) relays short-lived WebRTC offer, answer, ICE candidate, and leave messages.
- [`app/api/ice/route.js`](app/api/ice/route.js) returns the client ICE configuration for a matched ticket.
- [`app/api/telemetry/route.js`](app/api/telemetry/route.js) accepts safe, matched-ticket WebRTC diagnostics from the browser and writes structured events to Vercel Function Logs. It records ICE/connection states and selected candidate type (`host`, `srflx`, or `relay`) but never logs tickets, SDP, raw candidates, or TURN credentials.

The live-match host applies all actions, runs the simulation tick, and sends the complete resulting state after every action and tick. That state includes ship positions, energy, destroyed asteroids, ship damage, compact shot metadata, and bloom events. This is appropriate for casual play; it is not designed for ranked, competitive, or economic use.

### WebRTC diagnostics

Live matches emit verbose `[spectral-front:webrtc]` events in the browser console and forward safe summaries to Vercel. The definitive connection-route event is `selected_candidate_pair`: `relay` means TURN was used; `host` or `srflx` means the match connected directly. Inspect Vercel **Project → Logs** and filter for `spectral-front` or `/api/telemetry`. Do not log or share SDP, raw candidates, match tickets, or TURN credentials.

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
