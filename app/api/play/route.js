import { NextResponse } from 'next/server';
import { command } from '../../../lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const allowedEvents = new Set(['start', 'heartbeat', 'end']);
const allowedModes = new Set(['public', 'private', 'bot', 'onslaught', 'unknown']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const playerIdPattern = /^anon_[a-z0-9]{18,40}$/i;

const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const cleanString = (value, max = 80) => String(value || '').replace(/[^\w .:/-]/g, '').slice(0, max) || 'unknown';
const dayKey = timestamp => new Date(timestamp).toISOString().slice(0, 10);

function headerValue(headers, key) {
  const value = headers.get(key);
  if (!value) return 'unknown';
  try {
    return cleanString(decodeURIComponent(value), 80);
  } catch {
    return cleanString(value, 80);
  }
}

function geoFromHeaders(headers) {
  return {
    country: headerValue(headers, 'x-vercel-ip-country'),
    region: headerValue(headers, 'x-vercel-ip-country-region'),
    city: headerValue(headers, 'x-vercel-ip-city'),
    timezone: headerValue(headers, 'x-vercel-ip-timezone'),
  };
}

function flatten(object) {
  return Object.entries(object).flatMap(([key, value]) => [key, value == null ? '' : String(value)]);
}

export async function POST(request) {
  try {
    const body = await request.json();
    const sessionId = String(body.sessionId || '');
    const playerId = String(body.playerId || '');
    const event = String(body.event || '');
    const mode = allowedModes.has(body.mode) ? body.mode : 'unknown';
    const now = Date.now();

    if (!uuidPattern.test(sessionId)) return json({ error: 'Invalid play session.' }, 400);
    if (!playerIdPattern.test(playerId)) return json({ error: 'Invalid player id.' }, 400);
    if (!allowedEvents.has(event)) return json({ error: 'Invalid play event.' }, 400);

    const startedAt = Math.max(0, Math.round(Number(body.startedAt) || now));
    const durationMs = Math.max(0, Math.min(1000 * 60 * 60 * 12, Math.round(Number(body.durationMs) || 0)));
    const destroyed = Math.max(0, Math.min(10000, Math.round(Number(body.destroyed) || 0)));
    const matchId = cleanString(body.matchId, 80);
    const role = cleanString(body.role, 20);
    const outcome = cleanString(body.outcome, 20);
    const geo = geoFromHeaders(request.headers);
    const key = `sf:play-session:${sessionId}`;
    const startMarker = `sf:play-session-started:${sessionId}`;

    const fields = {
      sessionId,
      playerId,
      mode,
      matchId,
      role,
      startedAt,
      lastSeenAt: now,
      durationMs,
      event,
      outcome,
      destroyed,
      ...geo,
    };

    if (event === 'end') fields.endedAt = now;

    await command('HSET', key, ...flatten(fields));
    await command('EXPIRE', key, SESSION_TTL_SECONDS);
    await command('ZADD', 'sf:play-sessions', startedAt, sessionId);

    if (event === 'start') {
      const counted = await command('SET', startMarker, '1', 'NX', 'EX', SESSION_TTL_SECONDS);
      if (counted) {
        await command('INCR', 'sf:plays:total');
        await command('INCR', `sf:plays:mode:${mode}`);
        await command('HINCRBY', 'sf:plays:daily', dayKey(now), 1);
        await command('HINCRBY', 'sf:plays:country', geo.country, 1);
      }
    }

    return json({ ok: true });
  } catch (error) {
    return json({ error: error.message || 'Could not record play session.' }, 503);
  }
}
