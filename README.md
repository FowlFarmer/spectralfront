# Spectral Front

Minimal Vercel-deployable, casual two-player artillery game. The lobby atomically pairs two browser sessions; Upstash Redis carries only matchmaking and short-lived WebRTC signals. The match itself runs over a WebRTC data channel, with the host browser resolving the game state.

## Deploy

1. Import the repository into Vercel.
2. Add the **Upstash Redis** integration in Vercel, create a Redis database, and connect it to this project. It supplies `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. Deploy. TURN is intentionally optional for this MVP.

The bundled Google STUN entry is useful for this MVP, though some public-network pairings will fail without TURN. Add TURN only when connection reliability becomes the next priority.

## Intentional MVP boundaries

- One anonymous, 1v1 queue; queued tickets expire after 90 seconds.
- The route changes from lobby to `#/match/<id>` after pairing. Leave/cancel/disconnect return safely to the lobby.
- Three selectable ships per player; host starts; the selected ship is the Cartesian `(0,0)` for one function shot per turn; planets block arcs; first fleet destroyed loses.
- The host is authoritative. This is suitable for casual play, not ranked or economic competition.
- The expression parser is intentionally small and does not execute JavaScript submitted by players.
