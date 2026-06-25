// Arena notification policy. Toggle any `enabled` flag to false to suppress
// that event without changing game flow or multiplayer state.
export const ARENA_NOTIFICATIONS = Object.freeze({
  trainingInitialized: { enabled: true, message: 'New training sector initialized.', accent: '#55d5cc' },
  combatStaging: { enabled: true, message: 'Systems are locked until the launch signal.', accent: '#8cb4cc' },
  combatStarted: { enabled: true, message: 'Launch signal received. Energy systems online.', accent: '#55d5cc' },
  playerArcInFlight: { enabled: true, message: 'Arc in flight.', accent: '#55d5cc' },
  botArcInFlight: { enabled: true, message: 'Bot arc in flight.', accent: '#f27b82' },
  unstableFunction: { enabled: true, message: 'Unstable function — beam rejected.', accent: '#e46f78' },
  pathBlocked: { enabled: true, message: 'Route blocked by obstacle.', accent: '#e7bd61' },
  moveOrdered: { enabled: true, message: 'Ship moving to waypoint.', accent: '#55d5cc' },
  moveCancelled: { enabled: true, message: 'Ship braking to stop.', accent: '#8cb4cc' },
  notEnoughEnergyMove: { enabled: true, message: 'Not enough energy to move — need 25 to start.', accent: '#e7bd61' },
  notEnoughEnergyFire: { enabled: true, message: 'Not enough energy to fire at this power.', accent: '#e7bd61' },
  outOfEnergyMoving: { enabled: true, message: 'Energy depleted — ship braking to a stop.', accent: '#e7bd61' },
  enemyShipDestroyed: { enabled: true, message: 'Enemy ship destroyed.', accent: '#55e6a8' },
  selfShipDestroyed: { enabled: true, message: 'Friendly fire — you destroyed your own ship.', accent: '#ff9d66' },
  friendlyShipLost: { enabled: true, message: 'Direct hit. One of your ships lost.', accent: '#ff6b6b' },
  asteroidDestroyed: { enabled: true, message: 'Asteroid vaporized.', accent: '#aab5bb' },
  moonImpact: { enabled: true, message: 'Moon impact. Arc stopped.', accent: '#c9d5dc' },
  planetImpact: { enabled: true, message: 'Planetary impact. Arc stopped.', accent: '#ffaf6c' },
  beamExited: { enabled: true, message: 'Beam exits the sector.', accent: '#72b8ff' },
  beamRangeExpired: { enabled: true, message: 'Beam range exhausted.', accent: '#b79cff' },
});

export function notificationFor(key) {
  const notification = ARENA_NOTIFICATIONS[key];
  return notification?.enabled ? notification : null;
}
