export const WORLD = Object.freeze({ width: 1000, height: 600, grid: 50 });
export const SHIP_RADIUS = 8;
const ROLES = Object.freeze({ host: 'guest', guest: 'host' });
export const PLANET_TYPES = Object.freeze(['earthlike', 'marslike', 'venuslike', 'ice', 'gas']);
const SHIP_CLEARANCE = SHIP_RADIUS * 6, PLANET_CLEARANCE = 32;

export const createMatch = (seed = Math.floor(Math.random() * 0xffffffff)) => {
  const random = seededRandom(seed), ships = createFleets(random), planets = createPlanets(random, ships), asteroids = createAsteroids(random, ships, planets);
  return { seed, turn: 'host', round: 1, outcome: null, lastPath: [], ships, planets, asteroids };
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
      const candidate = { x: Math.round(between(random, 175, 825)), y: Math.round(between(random, r + 28, WORLD.height - r - 28)), r, volume: r ** 3, type: PLANET_TYPES[Math.floor(random() * PLANET_TYPES.length)], seed: Math.floor(random() * 0xffffffff) };
      const clearOfShips = allShips.every(ship => Math.hypot(candidate.x - ship.x, candidate.y - ship.y) > candidate.r + SHIP_CLEARANCE);
      const clearOfPlanets = planets.every(planet => Math.hypot(candidate.x - planet.x, candidate.y - planet.y) > candidate.r + planet.r + PLANET_CLEARANCE);
      if (clearOfShips && clearOfPlanets) { planets.push(candidate); break; }
    }
  }
  return planets;
}

function planetRadii(random, count) {
  const totalVolume = between(random, 400000, 620000), weights = Array.from({ length: count }, () => between(random, 0.22, 2.2)), weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map(weight => Math.round(Math.cbrt(totalVolume * weight / weightTotal))).sort((a, b) => b - a);
}

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
const cloneGame = game => ({ ...game, ships: { host: game.ships.host.map(ship => ({ ...ship })), guest: game.ships.guest.map(ship => ({ ...ship })) }, lastPath: [...game.lastPath] });
const advanceTurn = (game, role) => { const opponent = ROLES[role]; if (!liveShips(game, opponent).length) game.outcome = role; else { game.turn = opponent; game.round += 1; } };

export function resolveShot(game, { expression, role, shipIndex }) {
  if (!game || game.turn !== role || game.outcome || !game.ships[role][shipIndex]?.hp) return { game, ignored: true };
  const next = cloneGame(game);
  const path = trace(expression, next.ships[role][shipIndex], role);
  if (!path.length) { next.lastPath = []; next.turn = ROLES[role]; next.round += 1; return { game: next, unstable: true, hit: false }; }
  let hit = false;
  for (const point of path) {
    if (next.planets.some(planet => Math.hypot(point.x - planet.x, point.y - planet.y) < planet.r) || next.asteroids?.some(asteroid => Math.hypot(point.x - asteroid.x, point.y - asteroid.y) < asteroid.r)) break;
    const target = liveShips(next, ROLES[role]).find(ship => Math.hypot(point.x - ship.x, point.y - ship.y) < SHIP_RADIUS);
    if (target) { target.hp = 0; hit = true; break; }
  }
  next.lastPath = path;
  advanceTurn(next, role);
  return { game: next, hit, unstable: false };
}

export function chooseBotShot(game) {
  if (!game || game.turn !== 'guest' || game.outcome) return { game, ignored: true };
  for (const [shipIndex, ship] of game.ships.guest.entries()) {
    if (!ship.hp) continue;
    for (const target of liveShips(game, 'host')) {
      const result = resolveShot(game, { role: 'guest', shipIndex, expression: String((ship.y - target.y) / 42) });
      if (result.hit) return result;
    }
  }
  const next = cloneGame(game); next.lastPath = []; next.turn = 'host'; next.round += 1;
  return { game: next, hit: false, noShot: true };
}

export function trace(source, ship, role) {
  let fn; try { fn = compileExpression(source); } catch { return []; }
  const direction = role === 'host' ? 1 : -1, path = [];
  for (let index = 0; index < 520; index += 1) {
    const x = direction * (index / 519) * 12, y = fn(x), worldX = ship.x + x * 72, worldY = ship.y - y * 42;
    if (!Number.isFinite(y) || Math.abs(y) > 30 || worldY < 0 || worldY > WORLD.height || worldX < 0 || worldX > WORLD.width) break;
    path.push({ x: worldX, y: worldY });
  }
  return path;
}

function compileExpression(source) { const tokens = source.toLowerCase().match(/\s*(\d*\.?\d+|pi|x|sin|cos|tan|abs|sqrt|log|exp|[()+\-*/^])/g)?.map(token => token.trim()); if (!tokens?.length || tokens.join('') !== source.toLowerCase().replace(/\s/g, '')) throw Error(); const out = [], ops = [], precedence = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 }, functions = ['sin', 'cos', 'tan', 'abs', 'sqrt', 'log', 'exp']; let expect = true; for (const token of tokens) { if (/^\d|^(x|pi)$/.test(token)) { out.push(token); expect = false; continue; } if (functions.includes(token)) { ops.push(token); continue; } if (token === '(') { ops.push(token); expect = true; continue; } if (token === ')') { while (ops.length && ops.at(-1) !== '(') out.push(ops.pop()); if (ops.pop() !== '(') throw Error(); if (functions.includes(ops.at(-1))) out.push(ops.pop()); expect = false; continue; } if (token === '-' && expect) out.push('0'); if (!precedence[token]) throw Error(); while (ops.length && precedence[ops.at(-1)] && (token === '^' ? precedence[token] < precedence[ops.at(-1)] : precedence[token] <= precedence[ops.at(-1)])) out.push(ops.pop()); ops.push(token); expect = true; } while (ops.length) { const token = ops.pop(); if (token === '(') throw Error(); out.push(token); } return x => { const stack = []; for (const token of out) { if (/^\d/.test(token)) stack.push(+token); else if (token === 'x') stack.push(x); else if (token === 'pi') stack.push(Math.PI); else if (functions.includes(token)) { const value = stack.pop(); stack.push(Math[token === 'log' ? 'log' : token](value)); } else { const b = stack.pop(), a = stack.pop(); stack.push(token === '+' ? a + b : token === '-' ? a - b : token === '*' ? a * b : token === '/' ? a / b : Math.pow(a, b)); } } return stack.length === 1 ? stack[0] : NaN; }; }
