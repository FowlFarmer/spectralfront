export const WORLD = Object.freeze({ width: 1000, height: 600, grid: 50 });
// Rendering and simulation use world units; one background grid square is one graph unit.
export const WORLD_UNITS_PER_GRAPH_UNIT = WORLD.grid;
export const SHIP_RADIUS = 8;
export const SHOT_FLIGHT_MS = 195;
export const BEAM_TRAVEL_SPEED = 2400;
export const ENERGY_MAX = 100;
export const ENERGY_REGEN = 4;
export const BOT_ENERGY_REGEN = 2;
export const MOVE_INITIAL_COST = 20;
export const MOVE_ENERGY_PER_SEC = 3;
export const BEAM_DISTANCE_PER_POWER = 40;
export const MAX_BEAM_DISTANCE = BEAM_DISTANCE_PER_POWER * 100;
export const SHIP_MAX_SPEED = 2.13;
export const SHIP_ACCEL = 1.47;
export const SHIP_DECEL = 1.2;
export const SIM_TICK_MS = 50;
export const MATCH_COUNTDOWN_MS = 12_000;
export const MATCH_OUTCOME_DELAY_MS = 2_000;
export const BOT_OPENING_SHOT_DELAY_MS = 10_000;
export const BOT_SHOT_COOLDOWN_MS = 5_000;

const ROLES = Object.freeze({ host: 'guest', guest: 'host' });
export const PLANET_TYPES = Object.freeze(['moon', 'mercurian', 'lava', 'plutoid', 'marslike', 'desert', 'venuslike', 'earthlike', 'ocean', 'ice', 'superEarth', 'miniNeptune', 'neptune', 'uranian', 'gasGiant', 'saturnian']);
const SHIP_CLEARANCE = SHIP_RADIUS * 6, PLANET_CLEARANCE = 32;

export const fireEnergyCost = power => {
  const clamped = Math.max(5, Math.min(100, power));
  return 25 + ((clamped - 5) / 95) * 75;
};
export const beamDistanceForPower = power => Math.max(0, power) * BEAM_DISTANCE_PER_POWER;
export const worldDistanceToGraphUnits = distance => distance / WORLD_UNITS_PER_GRAPH_UNIT;
export const graphUnitsToWorldDistance = distance => distance * WORLD_UNITS_PER_GRAPH_UNIT;
export const beamFlightDuration = pathLength => Math.max(90, Math.min(320, (pathLength / BEAM_TRAVEL_SPEED) * 1000));
export const mirrorWorldX = x => WORLD.width - x;
export const measurePathLength = path => {
  let total = 0;
  for (let index = 1; index < path.length; index += 1) total += Math.hypot(path[index].x - path[index - 1].x, path[index].y - path[index - 1].y);
  return total;
};

export const createMatch = (seed = Math.floor(Math.random() * 0xffffffff), { botMatch = false } = {}) => {
  const random = seededRandom(seed), ships = createFleets(random), planets = createPlanets(random, ships), asteroids = createAsteroids(random, ships, planets);
  return { seed, simTime: 0, phase: 'countdown', countdownMs: MATCH_COUNTDOWN_MS, outcome: null, pendingOutcome: null, outcomeAt: null, endReason: null, shotNumber: 0, botLastShotAt: null, botShotsSinceRoam: 0, botRoamAfter: 3 + Math.floor(random() * 2), trails: [], blooms: [], energy: { host: 0, guest: 0 }, energyRegen: { host: ENERGY_REGEN, guest: botMatch ? BOT_ENERGY_REGEN : ENERGY_REGEN }, ships, planets, asteroids };
};

function createShip(x, y, role) {
  return { x, y, hp: 1, angle: role === 'host' ? 0 : Math.PI, vx: 0, vy: 0, waypoint: null, moving: false, braking: false };
}

function createFleets(random) {
  const margin = SHIP_RADIUS * 3, minimumSeparation = SHIP_RADIUS * 9;
  const fleet = side => {
    const ships = [], minX = side === 'host' ? margin : WORLD.width * (2 / 3) + margin, maxX = side === 'host' ? WORLD.width / 3 - margin : WORLD.width - margin;
    for (let attempt = 0; ships.length < 3 && attempt < 500; attempt += 1) {
      const candidate = createShip(Math.round(between(random, minX, maxX)), Math.round(between(random, margin, WORLD.height - margin)), side);
      if (ships.every(ship => Math.hypot(candidate.x - ship.x, candidate.y - ship.y) >= minimumSeparation)) ships.push(candidate);
    }
    if (ships.length !== 3) throw Error('Unable to place fleet.');
    return ships;
  };
  return { host: fleet('host'), guest: fleet('guest') };
}

function createPlanets(random, ships) {
  const planets = [], allShips = [...ships.host, ...ships.guest], count = 2 + Math.floor(random() * 5), radii = planetRadii(random, count);
  for (let index = 0; index < count; index += 1) {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const r = radii[index];
      const appearance = choosePlanetAppearance(random, r);
      const candidate = { x: Math.round(between(random, 175, 825)), y: Math.round(between(random, r + 28, WORLD.height - r - 28)), r, volume: r ** 3, seed: Math.floor(random() * 0xffffffff), ...appearance };
      candidate.moonBodies = createMoonBodies(candidate);
      const clearOfShips = allShips.every(ship => Math.hypot(candidate.x - ship.x, candidate.y - ship.y) > candidate.r + SHIP_CLEARANCE);
      const clearOfPlanets = planets.every(planet => Math.hypot(candidate.x - planet.x, candidate.y - planet.y) > candidate.r + planet.r + PLANET_CLEARANCE);
      if (clearOfShips && clearOfPlanets) { planets.push(candidate); break; }
    }
  }
  return planets;
}

function planetRadii(random, count) {
  const totalVolume = between(random, 400000, 620000), anchorCount = count >= 4 && random() < 0.7 ? 2 : 1;
  const weights = Array.from({ length: count }, (_, index) => index < anchorCount ? between(random, 2.8, 4.4) : between(random, 0.16, 0.55));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map(weight => Math.round(Math.cbrt(totalVolume * weight / weightTotal))).sort((a, b) => b - a);
}

function choosePlanetAppearance(random, radius) {
  const type = weightedPick(random, radius <= 32
    ? [['moon', 28], ['mercurian', 22], ['lava', 18], ['plutoid', 18], ['ice', 14]]
    : radius <= 44
      ? [['marslike', 21], ['desert', 17], ['venuslike', 16], ['ocean', 15], ['earthlike', 14], ['superEarth', 10], ['ice', 7]]
      : radius <= 56
        ? [['superEarth', 24], ['ocean', 20], ['miniNeptune', 20], ['ice', 14], ['earthlike', 12], ['venuslike', 10]]
        : radius <= 68
          ? [['miniNeptune', 35], ['neptune', 26], ['uranian', 20], ['ice', 12], ['superEarth', 7]]
          : [['gasGiant', 39], ['saturnian', 31], ['neptune', 16], ['uranian', 14]]);
  const rings = type === 'saturnian' || (type === 'gasGiant' && random() < 0.16);
  const moons = radius >= 55 && random() < 0.72 ? 1 + Math.floor(random() * (radius >= 68 ? 3 : 2)) : 0;
  return { type, rings, moons };
}

function createMoonBodies(planet) {
  const random = seededRandom(planet.seed ^ 0x9e3779b9);
  return Array.from({ length: planet.moons || 0 }, (_, index) => {
    const angle = random() * Math.PI * 2, distance = planet.r * (1.5 + index * 0.3 + random() * 0.32), r = Math.max(2, planet.r * (0.075 + random() * 0.04));
    return { id: `${planet.seed}-${index}`, x: planet.x + Math.cos(angle) * distance, y: planet.y + Math.sin(angle) * distance, r, seed: Math.floor(random() * 0xffffffff) };
  });
}

function weightedPick(random, entries) { const total = entries.reduce((sum, [, weight]) => sum + weight, 0); let cursor = random() * total; for (const [value, weight] of entries) { cursor -= weight; if (cursor <= 0) return value; } return entries.at(-1)[0]; }

function createAsteroids(random, ships, planets) {
  const asteroids = [], allShips = [...ships.host, ...ships.guest], count = 9 + Math.floor(random() * 7);
  for (let index = 0; index < count; index += 1) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const candidate = { id: index, x: Math.round(between(random, 205, 795)), y: Math.round(between(random, 28, WORLD.height - 28)), r: Math.round(between(random, 5, 13)), seed: Math.floor(random() * 0xffffffff) };
      const clearOfShips = allShips.every(ship => Math.hypot(candidate.x - ship.x, candidate.y - ship.y) > candidate.r + 32);
      const clearOfPlanets = planets.every(planet => Math.hypot(candidate.x - planet.x, candidate.y - planet.y) > candidate.r + planet.r + 18);
      const clearOfAsteroids = asteroids.every(asteroid => Math.hypot(candidate.x - asteroid.x, candidate.y - asteroid.y) > candidate.r + asteroid.r + 12);
      if (clearOfShips && clearOfPlanets && clearOfAsteroids) { asteroids.push(candidate); break; }
    }
  }
  return asteroids;
}

const between = (random, min, max) => min + random() * (max - min);
function seededRandom(seed) { let state = (seed >>> 0) || 1; return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0x100000000; }; }

export const liveShips = (game, role) => game.ships[role].filter(ship => ship.hp > 0);
export const isMatchOver = game => Boolean(game?.outcome);
export const isCombatLocked = game => Boolean(game?.outcome || game?.pendingOutcome);

const cloneGame = game => ({
  ...game,
  energy: { ...game.energy },
  ships: { host: game.ships.host.map(cloneShip), guest: game.ships.guest.map(cloneShip) },
  trails: [...(game.trails || [])],
  blooms: [...(game.blooms || [])],
});

function cloneShip(ship) {
  return { ...ship, waypoint: ship.waypoint ? { ...ship.waypoint } : null };
}

function checkOutcome(game) {
  if (game.outcome || game.pendingOutcome) return;
  for (const role of ['host', 'guest']) {
    if (!liveShips(game, ROLES[role]).length) {
      game.pendingOutcome = role;
      game.outcomeAt = (game.simTime || 0) + MATCH_OUTCOME_DELAY_MS;
      game.endReason = 'fleet-destroyed';
      return;
    }
  }
}

function resolvePendingOutcome(game) {
  if (game.outcome || !game.pendingOutcome) return;
  if ((game.simTime || 0) >= (game.outcomeAt || 0)) game.outcome = game.pendingOutcome;
}

export function advanceSimulation(game, deltaMs) {
  if (!game || isMatchOver(game)) return { game, events: [] };
  const next = cloneGame(game);
  next.simTime = (game.simTime || 0) + deltaMs;
  let activeDeltaMs = deltaMs;
  const events = [];
  if (next.phase === 'countdown') {
    if (next.simTime < (next.countdownMs ?? MATCH_COUNTDOWN_MS)) return { game: next, events };
    activeDeltaMs = Math.max(0, next.simTime - (next.countdownMs ?? MATCH_COUNTDOWN_MS));
    next.phase = 'live';
    events.push({ key: 'combatStarted' });
  }
  const dtSec = activeDeltaMs / 1000;
  for (const role of ['host', 'guest']) {
    next.energy[role] = Math.min(ENERGY_MAX, next.energy[role] + (next.energyRegen?.[role] ?? ENERGY_REGEN) * dtSec);
    for (const ship of next.ships[role]) {
      if (!ship.hp) continue;
      updateShipMovement(ship, dtSec);
      if (ship.moving && !ship.braking) {
        const cost = MOVE_ENERGY_PER_SEC * dtSec;
        if (next.energy[role] >= cost) next.energy[role] -= cost;
        else {
          beginBraking(ship);
          events.push({ key: 'outOfEnergyMoving', role });
        }
      }
    }
  }
  resolvePendingOutcome(next);
  return { game: next, events };
}

function beginBraking(ship) {
  ship.braking = true;
  ship.moving = false;
  ship.waypoint = null;
}

function finishArrival(ship) {
  ship.vx = 0; ship.vy = 0; ship.moving = false; ship.waypoint = null;
}

function updateShipMovement(ship, dtSec) {
  const margin = SHIP_RADIUS * 2, minSpeed = 0.03;
  if (ship.braking) {
    applyDeceleration(ship, dtSec, minSpeed);
  } else if (ship.waypoint && ship.moving) {
    const dx = ship.waypoint.x - ship.x, dy = ship.waypoint.y - ship.y, dist = Math.hypot(dx, dy);
    const speed = Math.hypot(ship.vx, ship.vy);
    if (dist < minSpeed && speed < minSpeed) {
      finishArrival(ship);
    } else if (dist > 0.001) {
      const dirX = dx / dist, dirY = dy / dist;
      const desiredSpeed = Math.min(SHIP_MAX_SPEED, Math.sqrt(2 * SHIP_DECEL * dist));
      let newSpeed;
      if (speed < desiredSpeed) newSpeed = Math.min(desiredSpeed, speed + SHIP_ACCEL * dtSec);
      else newSpeed = Math.max(desiredSpeed, speed - SHIP_DECEL * dtSec);
      newSpeed = Math.min(newSpeed, dist / dtSec);
      if (newSpeed < minSpeed && dist < 0.8) finishArrival(ship);
      else {
        ship.vx = dirX * newSpeed;
        ship.vy = dirY * newSpeed;
      }
    } else finishArrival(ship);
  }
  ship.x = Math.max(margin, Math.min(WORLD.width - margin, ship.x + ship.vx * dtSec));
  ship.y = Math.max(margin, Math.min(WORLD.height - margin, ship.y + ship.vy * dtSec));
}

function applyDeceleration(ship, dtSec, minSpeed) {
  const speed = Math.hypot(ship.vx, ship.vy);
  if (speed < minSpeed) {
    ship.vx = 0; ship.vy = 0; ship.braking = false; return;
  }
  const newSpeed = Math.max(0, speed - SHIP_DECEL * dtSec);
  ship.vx = (ship.vx / speed) * newSpeed;
  ship.vy = (ship.vy / speed) * newSpeed;
  if (newSpeed < minSpeed) {
    ship.vx = 0; ship.vy = 0; ship.braking = false;
  }
}

export function applyGameAction(game, action) {
  if (!action || isCombatLocked(game)) return { game, ignored: true };
  if (game.phase !== 'live') return { game, ignored: true, reason: 'countdown' };
  if (action.type === 'fire') return applyFire(game, action);
  if (action.type === 'move') return applyMove(game, action);
  if (action.type === 'cancelMove') return applyCancelMove(game, action);
  return { game, ignored: true };
}

function applyFire(game, action) {
  const { expression, role, shipIndex, power = 100 } = action;
  const clampedPower = Math.max(1, Math.min(100, power));
  const cost = fireEnergyCost(clampedPower);
  if (!game.ships[role][shipIndex]?.hp) return { game, ignored: true };
  if (game.energy[role] < cost) return { game, ignored: true, reason: 'lowEnergyFire' };
  const next = cloneGame(game);
  const ship = next.ships[role][shipIndex];
  const maxDistance = beamDistanceForPower(clampedPower);
  const path = trace(expression, ship, role, maxDistance);
  if (!path.length) return { game: next, unstable: true, hit: false };
  next.energy[role] -= cost;
  let impact = null, resolvedPath = [];
  for (const point of path) {
    resolvedPath.push(point);
    const asteroid = next.asteroids?.find(candidate => Math.hypot(point.x - candidate.x, point.y - candidate.y) < candidate.r);
    if (asteroid) { impact = { kind: 'asteroid', x: point.x, y: point.y, seed: asteroid.seed, asteroidId: asteroid.id }; break; }
    const planet = next.planets.find(candidate => Math.hypot(point.x - candidate.x, point.y - candidate.y) < candidate.r);
    if (planet) { impact = { kind: 'planet', x: point.x, y: point.y, seed: planet.seed }; break; }
    const moon = next.planets.flatMap(planet => planet.moonBodies || []).find(candidate => Math.hypot(point.x - candidate.x, point.y - candidate.y) < candidate.r);
    if (moon) { impact = { kind: 'moon', x: point.x, y: point.y, seed: moon.seed, moonId: moon.id }; break; }
    const targetIndex = next.ships[ROLES[role]].findIndex(ship => ship.hp && Math.hypot(point.x - ship.x, point.y - ship.y) < SHIP_RADIUS);
    if (targetIndex >= 0) { impact = { kind: 'ship', x: point.x, y: point.y, seed: (game.shotNumber || 0) + 1, shipRole: ROLES[role], shipIndex: targetIndex }; break; }
  }
  const pathLength = measurePathLength(resolvedPath);
  const stopReason = impact ? 'impact' : classifyPathStop(pathLength, maxDistance);
  next.shotNumber = (game.shotNumber || 0) + 1;
  const trail = {
    id: next.shotNumber, role, shipIndex, expression, origin: { x: ship.x, y: ship.y }, impact,
    maxDistance, power: clampedPower, stopReason, pathLength, flightDuration: beamFlightDuration(pathLength),
  };
  next.trails = [...(next.trails || []), trail].slice(-8);
  if (action.bot) { next.botLastShotAt = next.simTime; next.botShotsSinceRoam = (next.botShotsSinceRoam || 0) + 1; }
  let hit = false;
  if (impact?.kind === 'asteroid') next.asteroids = next.asteroids.filter(asteroid => asteroid.id !== impact.asteroidId);
  if (impact?.kind === 'ship') {
    const target = next.ships[impact.shipRole]?.[impact.shipIndex];
    if (target?.hp) { target.hp = 0; hit = true; }
  }
  if (impact) next.blooms = [...(next.blooms || []), { id: next.shotNumber, impact }].slice(-8);
  checkOutcome(next);
  return { game: next, hit, impact, unstable: false, stopReason };
}

function classifyPathStop(pathLength, maxDistance) {
  if (pathLength >= maxDistance * 0.94) return 'range';
  return 'bounds';
}

function applyMove(game, action) {
  const { role, shipIndex, x, y } = action;
  const ship = game.ships[role]?.[shipIndex];
  if (!ship?.hp) return { game, ignored: true };
  if (game.energy[role] < MOVE_INITIAL_COST) return { game, ignored: true, reason: 'lowEnergyMove' };
  const target = { x: Math.max(SHIP_RADIUS, Math.min(WORLD.width - SHIP_RADIUS, x)), y: Math.max(SHIP_RADIUS, Math.min(WORLD.height - SHIP_RADIUS, y)) };
  if (Math.hypot(target.x - ship.x, target.y - ship.y) < 6) return { game, ignored: true };
  if (!isSegmentClear(game, ship, target)) return { game, ignored: true, blocked: true };
  const next = cloneGame(game);
  const nextShip = next.ships[role][shipIndex];
  next.energy[role] -= MOVE_INITIAL_COST;
  nextShip.waypoint = target;
  nextShip.moving = true;
  nextShip.braking = false;
  if (action.botRoam) { next.botShotsSinceRoam = 0; next.botRoamAfter = action.nextRoamAfter === 4 ? 4 : 3; }
  return { game: next, moved: true };
}

function applyCancelMove(game, action) {
  const { role, shipIndex } = action;
  const ship = game.ships[role]?.[shipIndex];
  if (!ship?.hp || (!ship.moving && !ship.braking)) return { game, ignored: true };
  const next = cloneGame(game);
  beginBraking(next.ships[role][shipIndex]);
  return { game: next, cancelled: true };
}

export function isSegmentClear(game, from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
  if (length < 1) return true;
  const steps = Math.max(4, Math.ceil(length / 5));
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const point = { x: from.x + dx * t, y: from.y + dy * t };
    if (hitsObstacle(game, point)) return false;
  }
  return true;
}

function hitsObstacle(game, point) {
  if (game.planets.some(planet => Math.hypot(point.x - planet.x, point.y - planet.y) < planet.r + SHIP_RADIUS)) return true;
  if (game.planets.some(planet => (planet.moonBodies || []).some(moon => Math.hypot(point.x - moon.x, point.y - moon.y) < moon.r + SHIP_RADIUS))) return true;
  if ((game.asteroids || []).some(asteroid => Math.hypot(point.x - asteroid.x, point.y - asteroid.y) < asteroid.r + SHIP_RADIUS)) return true;
  return false;
}

export function createBotAction(game) {
  if (!game || isCombatLocked(game) || game.phase !== 'live') return null;
  const energy = game.energy.guest;
  const shooters = game.ships.guest.map((ship, index) => ({ ship, index })).filter(({ ship }) => ship.hp);
  if (!shooters.length) return null;
  const targets = liveShips(game, 'host');
  if (!targets.length) return null;

  const movingShip = shooters.find(({ ship }) => ship.moving && !ship.braking);
  if (movingShip) return null;

  if ((game.botShotsSinceRoam || 0) >= (game.botRoamAfter || 3)) {
    if (energy < ENERGY_MAX) return null;
    const rover = shooters[Math.floor(Math.random() * shooters.length)];
    const waypoint = findRandomWaypoint(game, rover.ship);
    if (waypoint) return { type: 'move', role: 'guest', shipIndex: rover.index, x: waypoint.x, y: waypoint.y, botRoam: true, nextRoamAfter: 3 + Math.floor(Math.random() * 2) };
  }

  const combatTime = Math.max(0, game.simTime - (game.countdownMs ?? MATCH_COUNTDOWN_MS));
  const canFire = combatTime >= BOT_OPENING_SHOT_DELAY_MS && (game.botLastShotAt === null || game.simTime - game.botLastShotAt >= BOT_SHOT_COOLDOWN_MS);
  for (const { ship, index } of shuffle(shooters)) {
    const target = targets[Math.floor(Math.random() * targets.length)];
    const shot = findBestShot(game, ship, index, target, energy);
    if (shot) return canFire ? { ...shot, bot: true } : null;
  }

  for (const { ship, index } of shuffle(shooters)) {
    const target = targets[Math.floor(Math.random() * targets.length)];
    const waypoint = findTacticalWaypoint(game, ship, target);
    if (waypoint && energy >= ENERGY_MAX) {
      return { type: 'move', role: 'guest', shipIndex: index, x: waypoint.x, y: waypoint.y };
    }
  }

  return null;
}

function findRandomWaypoint(game, ship) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const angle = Math.random() * Math.PI * 2, distance = 55 + Math.random() * 165;
    const candidate = { x: Math.round(ship.x + Math.cos(angle) * distance), y: Math.round(ship.y + Math.sin(angle) * distance) };
    if (candidate.x < SHIP_RADIUS * 2 || candidate.x > WORLD.width - SHIP_RADIUS * 2 || candidate.y < SHIP_RADIUS * 2 || candidate.y > WORLD.height - SHIP_RADIUS * 2) continue;
    if (isSegmentClear(game, ship, candidate)) return candidate;
  }
  return null;
}

function findBestShot(game, shooter, shipIndex, target, energy) {
  const solution = solveRoute(game, shooter, target);
  if (!solution) return null;
  const power = Math.min(100, Math.max(40, Math.round((Math.hypot(target.x - shooter.x, target.y - shooter.y) / MAX_BEAM_DISTANCE) * 100 + 15)));
  if (energy < fireEnergyCost(power)) return null;
  if (Math.random() < 0.32) return { type: 'fire', role: 'guest', shipIndex, expression: solution, power };
  const targetX = Math.abs(worldDistanceToGraphUnits(target.x - shooter.x));
  const missDistance = SHIP_RADIUS * 2 + Math.random() * (SHIP_RADIUS * 4);
  const shift = (Math.random() < 0.5 ? -1 : 1) * missDistance / Math.max(targetX * WORLD_UNITS_PER_GRAPH_UNIT, 1);
  return { type: 'fire', role: 'guest', shipIndex, expression: `(${solution})+(${shift.toFixed(3)})*x`, power };
}

function findTacticalWaypoint(game, shooter, target) {
  const baseAngle = Math.atan2(target.y - shooter.y, target.x - shooter.x);
  const radii = [55, 85, 120, 160, 210];
  const angleOffsets = shuffle([-0.55, -0.35, -0.18, 0, 0.18, 0.35, 0.55, 0.85, -0.85]);
  for (const radius of radii) {
    for (const offset of angleOffsets) {
      const angle = baseAngle + offset;
      const candidate = {
        x: Math.round(shooter.x + Math.cos(angle) * radius),
        y: Math.round(shooter.y + Math.sin(angle) * radius),
      };
      if (candidate.x < SHIP_RADIUS * 2 || candidate.x > WORLD.width - SHIP_RADIUS * 2) continue;
      if (candidate.y < SHIP_RADIUS * 2 || candidate.y > WORLD.height - SHIP_RADIUS * 2) continue;
      if (!isSegmentClear(game, shooter, candidate)) continue;
      const virtualShooter = { ...shooter, x: candidate.x, y: candidate.y };
      if (solveRoute(game, virtualShooter, target)) return candidate;
    }
  }
  return null;
}

function solveRoute(game, shooter, target) {
  const targetX = worldDistanceToGraphUnits(target.x - shooter.x), targetY = worldDistanceToGraphUnits(shooter.y - target.y);
  if (Math.abs(targetX) < 0.05) return null;
  const slope = targetY / targetX;
  const curvatures = shuffle([-1.5, -1.1, -0.8, -0.55, -0.32, -0.18, 0, 0.18, 0.32, 0.55, 0.8, 1.1, 1.5]);
  for (const curvature of curvatures) {
    const expression = `(${slope.toFixed(4)})*x+(${curvature.toFixed(3)})*x*(x-(${targetX.toFixed(4)}))`;
    const path = trace(expression, shooter, 'guest', MAX_BEAM_DISTANCE);
    if (pathReachesTarget(game, path, target)) return expression;
  }
  return null;
}

function pathReachesTarget(game, path, target) {
  for (const point of path) {
    if (hitsPlanet(game, point)) return false;
    if (Math.hypot(point.x - target.x, point.y - target.y) < SHIP_RADIUS) return true;
  }
  return false;
}

function hitsPlanet(game, point) {
  return game.planets.some(planet => Math.hypot(point.x - planet.x, point.y - planet.y) < planet.r || (planet.moonBodies || []).some(moon => Math.hypot(point.x - moon.x, point.y - moon.y) < moon.r));
}

function shuffle(values) {
  const next = [...values];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [next[index], next[swap]] = [next[swap], next[index]];
  }
  return next;
}

export function trace(source, ship, role, maxDistance = MAX_BEAM_DISTANCE) {
  let fn; try { fn = compileExpression(source); } catch { return []; }
  const originValue = fn(0); if (!Number.isFinite(originValue)) return [];
  const direction = role === 'host' ? 1 : -1, path = [];
  let traveled = 0, previous = null;
  const graphLimit = Math.ceil(Math.hypot(WORLD.width, WORLD.height) / WORLD_UNITS_PER_GRAPH_UNIT) + 2;
  for (let index = 0; index < 520; index += 1) {
    const x = direction * (index / 519) * graphLimit, y = fn(x) - originValue, worldX = ship.x + graphUnitsToWorldDistance(x), worldY = ship.y - graphUnitsToWorldDistance(y);
    if (!Number.isFinite(y) || Math.abs(y) > 30 || worldY < 0 || worldY > WORLD.height || worldX < 0 || worldX > WORLD.width) break;
    const point = { x: worldX, y: worldY };
    if (previous) {
      traveled += Math.hypot(point.x - previous.x, point.y - previous.y);
      if (traveled > maxDistance) {
        const overshoot = traveled - maxDistance;
        const segment = Math.hypot(point.x - previous.x, point.y - previous.y) || 1;
        const ratio = 1 - overshoot / segment;
        path.push({ x: previous.x + (point.x - previous.x) * ratio, y: previous.y + (point.y - previous.y) * ratio });
        break;
      }
    }
    path.push(point);
    previous = point;
  }
  return path;
}

function compileExpression(source) {
  const functionMap = { sin: Math.sin, cos: Math.cos, tan: Math.tan, abs: Math.abs, sqrt: Math.sqrt, log: Math.log, ln: Math.log, exp: Math.exp };
  const functions = Object.keys(functionMap);
  const rawTokens = source.toLowerCase().match(/\s*(\d*\.?\d+|pi|x|sin|cos|tan|abs|sqrt|log|ln|exp|[()+\-*/^])/g)?.map(token => token.trim());
  if (!rawTokens?.length || rawTokens.join('') !== source.toLowerCase().replace(/\s/g, '')) throw Error();
  const tokens = insertImplicitMultiplication(rawTokens, functions), out = [], ops = [], precedence = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 };
  let expect = true;
  for (const token of tokens) {
    if (/^\d|^(x|pi)$/.test(token)) { out.push(token); expect = false; continue; }
    if (functions.includes(token)) { ops.push(token); continue; }
    if (token === '(') { ops.push(token); expect = true; continue; }
    if (token === ')') { while (ops.length && ops.at(-1) !== '(') out.push(ops.pop()); if (ops.pop() !== '(') throw Error(); if (functions.includes(ops.at(-1))) out.push(ops.pop()); expect = false; continue; }
    if (token === '-' && expect) out.push('0');
    if (!precedence[token]) throw Error();
    while (ops.length && precedence[ops.at(-1)] && (token === '^' ? precedence[token] < precedence[ops.at(-1)] : precedence[token] <= precedence[ops.at(-1)])) out.push(ops.pop());
    ops.push(token); expect = true;
  }
  while (ops.length) { const token = ops.pop(); if (token === '(') throw Error(); out.push(token); }
  return x => {
    const stack = [];
    for (const token of out) {
      if (/^\d/.test(token)) stack.push(+token);
      else if (token === 'x') stack.push(x);
      else if (token === 'pi') stack.push(Math.PI);
      else if (functions.includes(token)) { const value = stack.pop(); if (value === undefined) return NaN; stack.push(functionMap[token](value)); }
      else { const b = stack.pop(), a = stack.pop(); if (a === undefined || b === undefined) return NaN; stack.push(token === '+' ? a + b : token === '-' ? a - b : token === '*' ? a * b : token === '/' ? a / b : Math.pow(a, b)); }
    }
    return stack.length === 1 ? stack[0] : NaN;
  };
}

function insertImplicitMultiplication(tokens, functions) {
  const isValueEnd = token => /^\d/.test(token) || token === 'x' || token === 'pi' || token === ')';
  const isValueStart = token => /^\d/.test(token) || token === 'x' || token === 'pi' || token === '(' || functions.includes(token);
  const normalized = [];
  for (const token of tokens) {
    const previous = normalized.at(-1);
    if (previous && isValueEnd(previous) && isValueStart(token)) normalized.push('*');
    normalized.push(token);
  }
  return normalized;
}
