'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SHIP_RADIUS, SHOT_FLIGHT_MS, WORLD } from './game-model';

export default function ArenaCanvas({ game, role, selected, onSelectShip }) {
  const viewport = useRef(null), canvas = useRef(null);
  // Shared game events only carry a stable shot id. Each client owns its
  // animation clock, which avoids assuming its system clock matches the host.
  const eventStarts = useRef(new Map());
  const [now, setNow] = useState(() => performance.now()), [cursor, setCursor] = useState(null);
  const eventAge = event => {
    let start = eventStarts.current.get(event.id);
    if (start === undefined) {
      start = performance.now();
      eventStarts.current.set(event.id, start);
    }
    return Math.max(0, now - start);
  };
  const draw = useCallback(() => {
    const element = canvas.current, box = viewport.current;
    if (!element || !box || !game) return;
    const bounds = box.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(bounds.width * ratio)), height = Math.max(1, Math.round(bounds.height * ratio));
    if (element.width !== width) element.width = width;
    if (element.height !== height) element.height = height;
    const ctx = element.getContext('2d');
    ctx.setTransform(width / WORLD.width, 0, 0, height / WORLD.height, 0, 0);
    drawSpace(ctx, game.seed);
    ctx.strokeStyle = '#172b3b'; ctx.lineWidth = 1;
    for (let x = 0; x < WORLD.width; x += WORLD.grid) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD.height); ctx.stroke(); }
    for (let y = 0; y < WORLD.height; y += WORLD.grid) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD.width, y); ctx.stroke(); }
    const origin = game.ships[role]?.[selected];
    if (origin?.hp) { ctx.setLineDash([5, 6]); ctx.strokeStyle = '#5fe2d455'; ctx.beginPath(); ctx.moveTo(0, origin.y); ctx.lineTo(WORLD.width, origin.y); ctx.moveTo(origin.x, 0); ctx.lineTo(origin.x, WORLD.height); ctx.stroke(); ctx.setLineDash([]); ctx.strokeStyle = '#5fe2d4'; ctx.beginPath(); ctx.arc(origin.x, origin.y, SHIP_RADIUS + 2, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = '#a7dcd8'; ctx.font = '10px DM Mono'; ctx.fillText('(0, 0)', origin.x + 15, origin.y - 13); }
    for (const planet of game.planets) drawPlanet(ctx, planet);
    for (const asteroid of game.asteroids || []) drawAsteroid(ctx, asteroid);
    for (const trail of game.trails || []) { const age = eventAge(trail); if (age < TRAIL_DURATION) drawLaserTrail(ctx, trail, age); }
    for (const bloom of game.blooms || []) { const age = eventAge(bloom); if (age >= FLIGHT_TIME && age < SHOT_DURATION) drawImpactBurst(ctx, bloom.impact, age - FLIGHT_TIME); }
    for (const [shipRole, ships] of Object.entries(game.ships)) for (const ship of ships) { if (!ship.hp) continue; ctx.save(); ctx.translate(ship.x, ship.y); ctx.fillStyle = shipRole === 'host' ? '#5fe2d4' : '#f27b82'; ctx.beginPath(); ctx.moveTo(shipRole === 'host' ? SHIP_RADIUS : -SHIP_RADIUS, 0); ctx.lineTo(shipRole === 'host' ? -6 : 6, -4); ctx.lineTo(shipRole === 'host' ? -3 : 3, 0); ctx.lineTo(shipRole === 'host' ? -6 : 6, 4); ctx.closePath(); ctx.fill(); ctx.restore(); }
    if (cursor) drawCursorReadout(ctx, cursor, origin, bounds);
  }, [cursor, game, now, role, selected]);
  useEffect(() => { draw(); }, [draw]);
  useEffect(() => { const element = viewport.current; if (!element) return; const observer = new ResizeObserver(draw); observer.observe(element); return () => observer.disconnect(); }, [draw]);
  useEffect(() => {
    const events = [...(game.trails || []), ...(game.blooms || [])], activeIds = new Set(events.map(event => event.id)), startedAt = performance.now();
    for (const event of events) if (!eventStarts.current.has(event.id)) eventStarts.current.set(event.id, startedAt);
    for (const id of eventStarts.current.keys()) if (!activeIds.has(id)) eventStarts.current.delete(id);
    const hasActiveEvent = time => (game.trails || []).some(trail => time - eventStarts.current.get(trail.id) < TRAIL_DURATION) || (game.blooms || []).some(bloom => time - eventStarts.current.get(bloom.id) < SHOT_DURATION);
    if (!hasActiveEvent(startedAt)) return;
    let frame;
    const tick = () => {
      const time = performance.now();
      setNow(time);
      if (hasActiveEvent(time)) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [game.trails, game.blooms]);
  const selectShipAt = event => { const point = pointerToWorld(event, canvas.current), index = game.ships[role].findIndex(ship => ship.hp && Math.hypot(ship.x - point.x, ship.y - point.y) <= SHIP_RADIUS + 7); if (index >= 0) onSelectShip(index); };
  const trackCursor = event => setCursor(pointerToWorld(event, canvas.current));
  return <div className="canvas-stage" ref={viewport}><canvas ref={canvas} aria-label="Match arena" onClick={selectShipAt} onPointerMove={trackCursor} onPointerLeave={() => setCursor(null)} /></div>;
}

const FLIGHT_TIME = SHOT_FLIGHT_MS, BLOOM_DURATION = 5200, SHOT_DURATION = FLIGHT_TIME + BLOOM_DURATION, TRAIL_FADE_TIME = 4200, TRAIL_DURATION = FLIGHT_TIME + TRAIL_FADE_TIME;
function pointerToWorld(event, element) { const bounds = element.getBoundingClientRect(); return { x: Math.max(0, Math.min(WORLD.width, (event.clientX - bounds.left) / bounds.width * WORLD.width)), y: Math.max(0, Math.min(WORLD.height, (event.clientY - bounds.top) / bounds.height * WORLD.height)) }; }
function drawCursorReadout(ctx, cursor, origin, bounds) {
  ctx.save(); ctx.font = '10px DM Mono'; ctx.textBaseline = 'middle';
  const xValue = origin ? (cursor.x - origin.x) / 72 : cursor.x, yValue = origin ? (origin.y - cursor.y) / 42 : WORLD.height - cursor.y, text = `x ${formatCoordinate(xValue)}   y ${formatCoordinate(yValue)}`, paddingX = 8, height = 21, width = ctx.measureText(text).width + paddingX * 2, offsetX = 12 / bounds.width * WORLD.width, offsetY = 17 / bounds.height * WORLD.height, x = Math.min(cursor.x + offsetX, WORLD.width - width - 3), y = Math.min(cursor.y + offsetY, WORLD.height - height - 3);
  ctx.fillStyle = '#05111ce8'; ctx.strokeStyle = '#58e7dcaa'; ctx.lineWidth = 0.75; ctx.fillRect(x, y, width, height); ctx.strokeRect(x, y, width, height); ctx.fillStyle = '#cffffa'; ctx.fillText(text, x + paddingX, y + height / 2 + 0.5); ctx.restore();
}
function formatCoordinate(value) { const rounded = Math.abs(value) < 0.005 ? 0 : value; return `${rounded >= 0 ? '+' : ''}${rounded.toFixed(2)}`; }
function drawLaserTrail(ctx, trail, age) {
  const { path, hit } = trail;
  if (path.length < 2) return;
  const progress = Math.min(1, age / FLIGHT_TIME), end = Math.max(1, Math.ceil(progress * (path.length - 1))), fade = age <= FLIGHT_TIME ? 1 : Math.max(0, 1 - (age - FLIGHT_TIME) / TRAIL_FADE_TIME), segment = path.slice(0, end + 1), head = segment.at(-1), color = hit ? '#ffaf6c' : '#4ccfff';
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = fade * 0.12; ctx.strokeStyle = color; ctx.lineWidth = 4.2; strokePath(ctx, segment); ctx.globalAlpha = fade * 0.26; ctx.lineWidth = 2.7; strokePath(ctx, segment); ctx.globalAlpha = fade * 0.55; ctx.strokeStyle = '#e9fbff'; ctx.lineWidth = 1.35; strokePath(ctx, segment); ctx.globalAlpha = fade * 0.8; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.48; strokePath(ctx, segment); if (age <= FLIGHT_TIME) { ctx.globalAlpha = 0.85; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(head.x, head.y, 1.8, 0, Math.PI * 2); ctx.fill(); } ctx.restore();
}
function strokePath(ctx, path) { ctx.beginPath(); path.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.stroke(); }
const FIRE_PARTICLE_COLORS = ['#fff4b0', '#ffcb42', '#f58a28', '#e14a1d', '#8f260f'];
function drawImpactBurst(ctx, impact, age) { const progress = Math.min(1, age / BLOOM_DURATION), travel = 1 - Math.exp(-7 * progress), quickFade = progress < 0.12 ? 1 - 0.72 * (progress / 0.12) : 0.28 * Math.pow(1 - (progress - 0.12) / 0.88, 0.42), random = seededRandom(impact.seed || 1), shipBurst = impact.kind === 'ship', count = shipBurst ? 42 : 26; ctx.save(); for (let index = 0; index < count; index += 1) { const angle = random() * Math.PI * 2, speed = (shipBurst ? 16 : 10) + random() * (shipBurst ? 58 : 42), distance = speed * travel, radius = 1.5 + travel * (shipBurst ? 5 + random() * 4 : 2 + random() * 3), alpha = quickFade * (0.35 + random() * 0.55), x = impact.x + Math.cos(angle) * distance, y = impact.y + Math.sin(angle) * distance; ctx.globalAlpha = alpha; ctx.fillStyle = shipBurst && index % 3 !== 0 ? FIRE_PARTICLE_COLORS[Math.floor(random() * FIRE_PARTICLE_COLORS.length)] : index % 3 ? '#aab5bb' : '#e2e7e8'; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); } ctx.restore(); }

const PALETTES = {
  moon: { core: '#b8c0c5', edge: '#35404a', land: '#79858d', detail: '#4c5862' },
  mercurian: { core: '#b4a79a', edge: '#332c2a', land: '#75645b', detail: '#4a3f3b' },
  lava: { core: '#f1822f', edge: '#3a110b', land: '#a62a14', detail: '#ffbd42' },
  plutoid: { core: '#d7c5b7', edge: '#392a36', land: '#a65c52', detail: '#f2e7d2', cloud: '#d9eef2' },
  earthlike: { core: '#1b7799', edge: '#08263f', land: '#4f8a54', detail: '#9bdcb4', cloud: '#ddf5eb' },
  marslike: { core: '#b54d32', edge: '#35120e', land: '#d98a57', detail: '#64271d' },
  desert: { core: '#d8a85f', edge: '#3b2818', land: '#e7c47d', detail: '#9b6030' },
  venuslike: { core: '#d99b42', edge: '#4d280c', land: '#f3d476', detail: '#a85f1e', cloud: '#ffe6a1' },
  ocean: { core: '#177fb7', edge: '#062e57', land: '#1f6f9a', detail: '#5fd0db', cloud: '#d8fbff' },
  ice: { core: '#93d8e5', edge: '#173c60', land: '#d9fbff', detail: '#4b94be' },
  superEarth: { core: '#7a8367', edge: '#202e2c', land: '#b1a473', detail: '#526450', cloud: '#e5e2c4' },
  miniNeptune: { core: '#47a2bb', edge: '#092a4a', land: '#78d6d5', detail: '#256ca0', cloud: '#c9fbf3' },
  neptune: { core: '#2663d1', edge: '#071a5b', land: '#4d9fff', detail: '#163c9c', cloud: '#b6d8ff' },
  uranian: { core: '#8ad5d3', edge: '#153b4f', land: '#c3f0e4', detail: '#4c9fa8', cloud: '#e5ffff' },
  gasGiant: { core: '#d79b55', edge: '#3a1c18', land: '#f0c27a', detail: '#92513a', cloud: '#ffe0a6' },
  saturnian: { core: '#d3b06f', edge: '#46351e', land: '#ebd49b', detail: '#96703d', cloud: '#fff0c6' },
};
const GAS_TYPES = new Set(['miniNeptune', 'neptune', 'uranian', 'gasGiant', 'saturnian']);

function drawSpace(ctx, seed) {
  const background = ctx.createRadialGradient(WORLD.width * 0.66, WORLD.height * 0.2, 20, WORLD.width * 0.5, WORLD.height * 0.5, WORLD.width * 0.78);
  background.addColorStop(0, '#071421'); background.addColorStop(0.55, '#030913'); background.addColorStop(1, '#01040a');
  ctx.fillStyle = background; ctx.fillRect(0, 0, WORLD.width, WORLD.height);
  const random = seededRandom(seed || 1);
  for (let index = 0; index < 105; index += 1) { const x = random() * WORLD.width, y = random() * WORLD.height, radius = random() < 0.08 ? 1.5 : 0.45 + random() * 0.75; ctx.fillStyle = random() < 0.16 ? '#8eb9df' : '#c9e1ef'; ctx.globalAlpha = 0.2 + random() * 0.58; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); } ctx.globalAlpha = 1;
}

function drawPlanet(ctx, planet) {
  const palette = PALETTES[planet.type] || PALETTES.earthlike, random = seededRandom(planet.seed || 1), lightX = planet.x - planet.r * 0.34, lightY = planet.y - planet.r * 0.38;
  if (planet.rings) drawRings(ctx, planet, palette);
  const base = ctx.createRadialGradient(lightX, lightY, planet.r * 0.08, planet.x, planet.y, planet.r);
  base.addColorStop(0, palette.core); base.addColorStop(0.62, palette.land); base.addColorStop(1, palette.edge);
  ctx.save(); ctx.beginPath(); ctx.arc(planet.x, planet.y, planet.r, 0, Math.PI * 2); ctx.clip(); ctx.fillStyle = base; ctx.fillRect(planet.x - planet.r, planet.y - planet.r, planet.r * 2, planet.r * 2);
  if (GAS_TYPES.has(planet.type)) {
    for (let index = 0; index < 10; index += 1) { const y = planet.y - planet.r + random() * planet.r * 2, height = 3 + random() * planet.r * 0.16; ctx.globalAlpha = 0.2 + random() * 0.35; ctx.fillStyle = index % 2 ? palette.detail : palette.cloud; ctx.fillRect(planet.x - planet.r, y, planet.r * 2, height); }
  } else {
    for (let index = 0; index < 30; index += 1) { const angle = random() * Math.PI * 2, distance = Math.sqrt(random()) * planet.r * 0.9, radius = 2 + random() * planet.r * 0.15; ctx.globalAlpha = 0.16 + random() * 0.32; ctx.fillStyle = index % 3 ? palette.detail : palette.land; ctx.beginPath(); ctx.arc(planet.x + Math.cos(angle) * distance, planet.y + Math.sin(angle) * distance, radius, 0, Math.PI * 2); ctx.fill(); }
    if (palette.cloud) for (let index = 0; index < 8; index += 1) { ctx.globalAlpha = 0.18; ctx.fillStyle = palette.cloud; ctx.beginPath(); ctx.ellipse(planet.x + (random() - 0.5) * planet.r * 1.5, planet.y + (random() - 0.5) * planet.r * 1.3, planet.r * (0.12 + random() * 0.18), planet.r * 0.045, random() * Math.PI, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.restore(); ctx.globalAlpha = 1; ctx.strokeStyle = `${palette.core}cc`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(planet.x, planet.y, planet.r, 0, Math.PI * 2); ctx.stroke(); drawMoons(ctx, planet, random);
}

function drawRings(ctx, planet, palette) { ctx.save(); ctx.translate(planet.x, planet.y); ctx.rotate(-0.22); ctx.strokeStyle = `${palette.cloud || palette.land}99`; ctx.lineWidth = Math.max(2, planet.r * 0.09); ctx.beginPath(); ctx.ellipse(0, 0, planet.r * 1.66, planet.r * 0.44, 0, 0, Math.PI * 2); ctx.stroke(); ctx.strokeStyle = `${palette.detail}bb`; ctx.lineWidth = Math.max(1, planet.r * 0.035); ctx.beginPath(); ctx.ellipse(0, 0, planet.r * 1.35, planet.r * 0.34, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }

function drawMoons(ctx, planet, random) { for (let index = 0; index < (planet.moons || 0); index += 1) { const angle = random() * Math.PI * 2, distance = planet.r * (1.5 + index * 0.3 + random() * 0.32), radius = Math.max(2, planet.r * (0.075 + random() * 0.04)), x = planet.x + Math.cos(angle) * distance, y = planet.y + Math.sin(angle) * distance; ctx.fillStyle = '#aebec4'; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#52636c'; ctx.lineWidth = 0.65; ctx.stroke(); } }

function drawAsteroid(ctx, asteroid) {
  const random = seededRandom(asteroid.seed || 1), points = 7 + Math.floor(random() * 4);
  ctx.save(); ctx.translate(asteroid.x, asteroid.y); ctx.beginPath();
  for (let index = 0; index < points; index += 1) { const angle = (index / points) * Math.PI * 2, radius = asteroid.r * (0.72 + random() * 0.35), x = Math.cos(angle) * radius, y = Math.sin(angle) * radius; index ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.closePath(); const gradient = ctx.createRadialGradient(-asteroid.r * 0.3, -asteroid.r * 0.35, 1, 0, 0, asteroid.r); gradient.addColorStop(0, '#8997a0'); gradient.addColorStop(0.5, '#46545d'); gradient.addColorStop(1, '#151e27'); ctx.fillStyle = gradient; ctx.fill(); ctx.strokeStyle = '#71818b'; ctx.lineWidth = 0.8; ctx.stroke();
  for (let index = 0; index < 2; index += 1) { ctx.globalAlpha = 0.35; ctx.fillStyle = '#19232c'; ctx.beginPath(); ctx.arc((random() - 0.5) * asteroid.r, (random() - 0.5) * asteroid.r, asteroid.r * (0.12 + random() * 0.12), 0, Math.PI * 2); ctx.fill(); } ctx.restore(); ctx.globalAlpha = 1;
}

function seededRandom(seed) { let state = (seed >>> 0) || 1; return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0x100000000; }; }
