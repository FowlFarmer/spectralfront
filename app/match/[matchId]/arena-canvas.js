'use client';

import { useCallback, useEffect, useRef } from 'react';
import { SHIP_RADIUS, WORLD } from './game-model';

export default function ArenaCanvas({ game, role, selected }) {
  const viewport = useRef(null), canvas = useRef(null);
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
    if (game.lastPath.length) { ctx.strokeStyle = '#f0c96a'; ctx.lineWidth = 3; ctx.beginPath(); game.lastPath.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.stroke(); }
    for (const [shipRole, ships] of Object.entries(game.ships)) for (const ship of ships) { if (!ship.hp) continue; ctx.save(); ctx.translate(ship.x, ship.y); ctx.fillStyle = shipRole === 'host' ? '#5fe2d4' : '#f27b82'; ctx.beginPath(); ctx.moveTo(shipRole === 'host' ? SHIP_RADIUS : -SHIP_RADIUS, 0); ctx.lineTo(shipRole === 'host' ? -6 : 6, -4); ctx.lineTo(shipRole === 'host' ? -3 : 3, 0); ctx.lineTo(shipRole === 'host' ? -6 : 6, 4); ctx.closePath(); ctx.fill(); ctx.restore(); }
  }, [game, role, selected]);
  useEffect(() => { draw(); }, [draw]);
  useEffect(() => { const element = viewport.current; if (!element) return; const observer = new ResizeObserver(draw); observer.observe(element); return () => observer.disconnect(); }, [draw]);
  return <div className="canvas-stage" ref={viewport}><canvas ref={canvas} aria-label="Match arena" /></div>;
}

const PALETTES = {
  earthlike: { core: '#1b7799', edge: '#08263f', land: '#4f8a54', detail: '#9bdcb4', cloud: '#ddf5eb' },
  marslike: { core: '#b54d32', edge: '#35120e', land: '#d98a57', detail: '#64271d' },
  venuslike: { core: '#d99b42', edge: '#4d280c', land: '#f3d476', detail: '#a85f1e', cloud: '#ffe6a1' },
  ice: { core: '#93d8e5', edge: '#173c60', land: '#d9fbff', detail: '#4b94be' },
  gas: { core: '#c77857', edge: '#3d1d2a', land: '#f2bb75', detail: '#85404f', cloud: '#f8d5a3' },
};

function drawSpace(ctx, seed) {
  const background = ctx.createRadialGradient(WORLD.width * 0.66, WORLD.height * 0.2, 20, WORLD.width * 0.5, WORLD.height * 0.5, WORLD.width * 0.78);
  background.addColorStop(0, '#071421'); background.addColorStop(0.55, '#030913'); background.addColorStop(1, '#01040a');
  ctx.fillStyle = background; ctx.fillRect(0, 0, WORLD.width, WORLD.height);
  const random = seededRandom(seed || 1);
  for (let index = 0; index < 105; index += 1) { const x = random() * WORLD.width, y = random() * WORLD.height, radius = random() < 0.08 ? 1.5 : 0.45 + random() * 0.75; ctx.fillStyle = random() < 0.16 ? '#8eb9df' : '#c9e1ef'; ctx.globalAlpha = 0.2 + random() * 0.58; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); } ctx.globalAlpha = 1;
}

function drawPlanet(ctx, planet) {
  const palette = PALETTES[planet.type] || PALETTES.earthlike, random = seededRandom(planet.seed || 1), lightX = planet.x - planet.r * 0.34, lightY = planet.y - planet.r * 0.38;
  const base = ctx.createRadialGradient(lightX, lightY, planet.r * 0.08, planet.x, planet.y, planet.r);
  base.addColorStop(0, palette.core); base.addColorStop(0.62, palette.land); base.addColorStop(1, palette.edge);
  ctx.save(); ctx.beginPath(); ctx.arc(planet.x, planet.y, planet.r, 0, Math.PI * 2); ctx.clip(); ctx.fillStyle = base; ctx.fillRect(planet.x - planet.r, planet.y - planet.r, planet.r * 2, planet.r * 2);
  if (planet.type === 'gas') {
    for (let index = 0; index < 10; index += 1) { const y = planet.y - planet.r + random() * planet.r * 2, height = 3 + random() * planet.r * 0.16; ctx.globalAlpha = 0.2 + random() * 0.35; ctx.fillStyle = index % 2 ? palette.detail : palette.cloud; ctx.fillRect(planet.x - planet.r, y, planet.r * 2, height); }
  } else {
    for (let index = 0; index < 30; index += 1) { const angle = random() * Math.PI * 2, distance = Math.sqrt(random()) * planet.r * 0.9, radius = 2 + random() * planet.r * 0.15; ctx.globalAlpha = 0.16 + random() * 0.32; ctx.fillStyle = index % 3 ? palette.detail : palette.land; ctx.beginPath(); ctx.arc(planet.x + Math.cos(angle) * distance, planet.y + Math.sin(angle) * distance, radius, 0, Math.PI * 2); ctx.fill(); }
    if (palette.cloud) for (let index = 0; index < 8; index += 1) { ctx.globalAlpha = 0.18; ctx.fillStyle = palette.cloud; ctx.beginPath(); ctx.ellipse(planet.x + (random() - 0.5) * planet.r * 1.5, planet.y + (random() - 0.5) * planet.r * 1.3, planet.r * (0.12 + random() * 0.18), planet.r * 0.045, random() * Math.PI, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.restore(); ctx.globalAlpha = 1; ctx.strokeStyle = `${palette.core}cc`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(planet.x, planet.y, planet.r, 0, Math.PI * 2); ctx.stroke();
}

function drawAsteroid(ctx, asteroid) {
  const random = seededRandom(asteroid.seed || 1), points = 7 + Math.floor(random() * 4);
  ctx.save(); ctx.translate(asteroid.x, asteroid.y); ctx.beginPath();
  for (let index = 0; index < points; index += 1) { const angle = (index / points) * Math.PI * 2, radius = asteroid.r * (0.72 + random() * 0.35), x = Math.cos(angle) * radius, y = Math.sin(angle) * radius; index ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.closePath(); const gradient = ctx.createRadialGradient(-asteroid.r * 0.3, -asteroid.r * 0.35, 1, 0, 0, asteroid.r); gradient.addColorStop(0, '#8997a0'); gradient.addColorStop(0.5, '#46545d'); gradient.addColorStop(1, '#151e27'); ctx.fillStyle = gradient; ctx.fill(); ctx.strokeStyle = '#71818b'; ctx.lineWidth = 0.8; ctx.stroke();
  for (let index = 0; index < 2; index += 1) { ctx.globalAlpha = 0.35; ctx.fillStyle = '#19232c'; ctx.beginPath(); ctx.arc((random() - 0.5) * asteroid.r, (random() - 0.5) * asteroid.r, asteroid.r * (0.12 + random() * 0.12), 0, Math.PI * 2); ctx.fill(); } ctx.restore(); ctx.globalAlpha = 1;
}

function seededRandom(seed) { let state = (seed >>> 0) || 1; return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0x100000000; }; }
