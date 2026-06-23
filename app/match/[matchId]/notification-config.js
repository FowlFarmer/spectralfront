// Arena notification policy. Toggle any `enabled` flag to false to suppress
// that event without changing game flow or multiplayer state.
export const ARENA_NOTIFICATIONS = Object.freeze({
  trainingInitialized: { enabled: true, message: 'New training sector initialized.' },
  playerArcInFlight: { enabled: true, message: 'Arc in flight.' },
  botArcInFlight: { enabled: true, message: 'Bot arc in flight.' },
  unstableFunction: { enabled: true, message: 'Unstable function — turn lost.' },
  directHit: { enabled: true, message: 'Direct hit. One ship lost.' },
  asteroidDestroyed: { enabled: true, message: 'Asteroid vaporized.' },
  moonImpact: { enabled: true, message: 'Moon impact. Arc stopped.' },
  planetImpact: { enabled: true, message: 'Planetary impact. Arc stopped.' },
  beamExited: { enabled: true, message: 'Beam exits the sector.' },
});

export function notificationFor(key) {
  const notification = ARENA_NOTIFICATIONS[key];
  return notification?.enabled ? notification.message : null;
}
