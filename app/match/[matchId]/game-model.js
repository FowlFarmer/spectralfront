export const WORLD = Object.freeze({ width: 1000, height: 600, grid: 50 });
export const SHIP_RADIUS = 8;
const ROLES = Object.freeze({ host: 'guest', guest: 'host' });
export const PLANET_TYPES = Object.freeze(['moon', 'mercurian', 'lava', 'plutoid', 'marslike', 'desert', 'venuslike', 'earthlike', 'ocean', 'ice', 'superEarth', 'miniNeptune', 'neptune', 'uranian', 'gasGiant', 'saturnian']);
const SHIP_CLEARANCE = SHIP_RADIUS * 6, PLANET_CLEARANCE = 32;

export const createMatch = (seed = Math.floor(Math.random() * 0xffffffff)) => {
  const random = seededRandom(seed), ships = createFleets(random), planets = createPlanets(random, ships), asteroids = createAsteroids(random, ships, planets);
  return { seed, turn: 'host', round: 1, outcome: null, shotNumber: 0, lastPath: [], lastShot: null, trails: [], ships, planets, asteroids };
};

function createFleets(random) {
  const margin = SHIP_RADIUS * 3, minimumSeparation = SHIP_RADIUS * 9;
  const fleet = side => {
    const ships = [], minX = side === 'host' ? margin : WORLD.width * (2 / 3) + margin, maxX = side === 'host' ? WORLD.width / 3 - margin : WORLD.width - margin;
    for (let attempt = 0; ships.length < 3 && attempt < 500; attempt += 1) {
      const candidate = { x: Math.round(between(random, minX, maxX)), y: Math.round(between(random, margin, WORLD.height - margin)), hp: 1 };
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

function weightedPick(random, entries) { const total = entries.reduce((sum, [, weight]) => sum + weight, 0); let cursor = random() * total; for (const [value, weight] of entries) { cursor -= weight; if (cursor <= 0) return value; } return entries.at(-1)[0]; }

function createAsteroids(random, ships, planets) {
  const asteroids = [], allShips = [...ships.host, ...ships.guest], count = 9 + Math.floor(random() * 7);
  for (let index = 0; index < count; index += 1) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const candidate = { x: Math.round(between(random, 205, 795)), y: Math.round(between(random, 28, WORLD.height - 28)), r: Math.round(between(random, 5, 13)), seed: Math.floor(random() * 0xffffffff) };
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
const cloneGame = game => ({ ...game, ships: { host: game.ships.host.map(ship => ({ ...ship })), guest: game.ships.guest.map(ship => ({ ...ship })) }, lastPath: [...game.lastPath], trails: [...(game.trails || [])] });
const advanceTurn = (game, role) => { const opponent = ROLES[role]; if (!liveShips(game, opponent).length) game.outcome = role; else { game.turn = opponent; game.round += 1; } };

export function applyGameAction(game, action) {
  if (!action || action.type !== 'fire') return { game, ignored: true };
  const { expression, role, shipIndex } = action;
  if (!game || game.turn !== role || game.outcome || !game.ships[role][shipIndex]?.hp) return { game, ignored: true };
  const next = cloneGame(game);
  const path = trace(expression, next.ships[role][shipIndex], role);
  if (!path.length) { next.turn = ROLES[role]; next.round += 1; return { game: next, unstable: true, hit: false }; }
  let hit = false, impact = null, resolvedPath = [];
  for (const point of path) {
    resolvedPath.push(point);
    const asteroid = next.asteroids?.find(candidate => Math.hypot(point.x - candidate.x, point.y - candidate.y) < candidate.r);
    if (asteroid) { next.asteroids = next.asteroids.filter(candidate => candidate !== asteroid); impact = { kind: 'asteroid', x: point.x, y: point.y, seed: asteroid.seed }; break; }
    const planet = next.planets.find(candidate => Math.hypot(point.x - candidate.x, point.y - candidate.y) < candidate.r);
    if (planet) { impact = { kind: 'planet', x: point.x, y: point.y, seed: planet.seed }; break; }
    const target = liveShips(next, ROLES[role]).find(ship => Math.hypot(point.x - ship.x, point.y - ship.y) < SHIP_RADIUS);
    if (target) { target.hp = 0; hit = true; impact = { kind: 'ship', x: point.x, y: point.y, seed: (game.shotNumber || 0) + 1 }; break; }
  }
  next.lastPath = resolvedPath; next.shotNumber = (game.shotNumber || 0) + 1;
  next.lastShot = { id: next.shotNumber, role, path: resolvedPath, hit, impact, createdAt: Date.now() };
  next.trails = [...(next.trails || []), next.lastShot].slice(-8);
  advanceTurn(next, role);
  return { game: next, hit, unstable: false };
}

export function createBotAction(game) {
  if (!game || game.turn !== 'guest' || game.outcome) return null;
  const random = Math.random, shooters = game.ships.guest.map((ship, index) => ({ ship, index })).filter(({ ship }) => ship.hp), targets = liveShips(game, 'host');
  const shooter = shooters[Math.floor(random() * shooters.length)], target = targets[Math.floor(random() * targets.length)], solution = solveRoute(game, shooter.ship, target);
  if (solution) {
    if (random() < 0.3) return { type: 'fire', role: 'guest', shipIndex: shooter.index, expression: solution };
    const shift = (random() < 0.5 ? -1 : 1) * between(random, 0.12, 0.3);
    return { type: 'fire', role: 'guest', shipIndex: shooter.index, expression: `(${solution})+(${shift.toFixed(3)})*x` };
  }
  return { type: 'fire', role: 'guest', shipIndex: shooter.index, expression: `${(random() < 0.5 ? -0.16 : 0.16)}*x` };
}

function solveRoute(game, shooter, target) {
  const targetX = (target.x - shooter.x) / 72, targetY = (shooter.y - target.y) / 42, slope = targetY / targetX;
  const curvatures = shuffle([-1.5, -1.1, -0.8, -0.55, -0.32, -0.18, 0, 0.18, 0.32, 0.55, 0.8, 1.1, 1.5]);
  for (const curvature of curvatures) {
    const expression = `(${slope.toFixed(4)})*x+(${curvature.toFixed(3)})*x*(x-(${targetX.toFixed(4)}))`, path = trace(expression, shooter, 'guest');
    if (pathReachesTarget(game, path, target)) return expression;
  }
  return null;
}

function pathReachesTarget(game, path, target) { for (const point of path) { if (hitsPlanet(game, point)) return false; if (Math.hypot(point.x - target.x, point.y - target.y) < SHIP_RADIUS) return true; } return false; }
function hitsPlanet(game, point) { return game.planets.some(planet => Math.hypot(point.x - planet.x, point.y - planet.y) < planet.r); }
function shuffle(values) { const next = [...values]; for (let index = next.length - 1; index > 0; index -= 1) { const swap = Math.floor(Math.random() * (index + 1)); [next[index], next[swap]] = [next[swap], next[index]]; } return next; }

export function trace(source, ship, role) {
  let fn; try { fn = compileExpression(source); } catch { return []; }
  const originValue = fn(0); if (!Number.isFinite(originValue)) return [];
  const direction = role === 'host' ? 1 : -1, path = [];
  for (let index = 0; index < 520; index += 1) {
    const x = direction * (index / 519) * 12, y = fn(x) - originValue, worldX = ship.x + x * 72, worldY = ship.y - y * 42;
    if (!Number.isFinite(y) || Math.abs(y) > 30 || worldY < 0 || worldY > WORLD.height || worldX < 0 || worldX > WORLD.width) break;
    path.push({ x: worldX, y: worldY });
  }
  return path;
}

function compileExpression(source) { const tokens = source.toLowerCase().match(/\s*(\d*\.?\d+|pi|x|sin|cos|tan|abs|sqrt|log|exp|[()+\-*/^])/g)?.map(token => token.trim()); if (!tokens?.length || tokens.join('') !== source.toLowerCase().replace(/\s/g, '')) throw Error(); const out = [], ops = [], precedence = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 }, functions = ['sin', 'cos', 'tan', 'abs', 'sqrt', 'log', 'exp']; let expect = true; for (const token of tokens) { if (/^\d|^(x|pi)$/.test(token)) { out.push(token); expect = false; continue; } if (functions.includes(token)) { ops.push(token); continue; } if (token === '(') { ops.push(token); expect = true; continue; } if (token === ')') { while (ops.length && ops.at(-1) !== '(') out.push(ops.pop()); if (ops.pop() !== '(') throw Error(); if (functions.includes(ops.at(-1))) out.push(ops.pop()); expect = false; continue; } if (token === '-' && expect) out.push('0'); if (!precedence[token]) throw Error(); while (ops.length && precedence[ops.at(-1)] && (token === '^' ? precedence[token] < precedence[ops.at(-1)] : precedence[token] <= precedence[ops.at(-1)])) out.push(ops.pop()); ops.push(token); expect = true; } while (ops.length) { const token = ops.pop(); if (token === '(') throw Error(); out.push(token); } return x => { const stack = []; for (const token of out) { if (/^\d/.test(token)) stack.push(+token); else if (token === 'x') stack.push(x); else if (token === 'pi') stack.push(Math.PI); else if (functions.includes(token)) { const value = stack.pop(); stack.push(Math[token === 'log' ? 'log' : token](value)); } else { const b = stack.pop(), a = stack.pop(); stack.push(token === '+' ? a + b : token === '-' ? a - b : token === '*' ? a * b : token === '/' ? a / b : Math.pow(a, b)); } } return stack.length === 1 ? stack[0] : NaN; }; }
