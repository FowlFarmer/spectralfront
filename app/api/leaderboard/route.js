import { NextResponse } from 'next/server';
import { command } from '../../../lib/kv';
import { validateUsername } from '../../../lib/usernames';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const leaderboardKey = 'sf:leaderboard:bot-clear';
const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

function parseLeaderboard(rows) {
  const entries = [];
  for (let index = 0; index < rows.length; index += 2) {
    const username = rows[index], timeMs = Number(rows[index + 1]);
    if (username && Number.isFinite(timeMs)) entries.push({ rank: entries.length + 1, username, timeMs });
  }
  return entries;
}

async function topEntries() {
  return parseLeaderboard(await command('ZRANGE', leaderboardKey, 0, 9, 'WITHSCORES'));
}

export async function GET() {
  try {
    return json({ leaderboard: await topEntries() });
  } catch {
    return json({ leaderboard: [], unavailable: true });
  }
}

export async function POST(request) {
  try {
    const { username: rawUsername, timeMs: rawTimeMs } = await request.json();
    const validation = validateUsername(rawUsername);
    const timeMs = Math.round(Number(rawTimeMs));
    if (!validation.ok) return json({ error: validation.error }, 400);
    if (!Number.isFinite(timeMs) || timeMs <= 0 || timeMs > 60 * 60 * 1000) return json({ error: 'Invalid bot clear time.' }, 400);

    const current = await command('ZSCORE', leaderboardKey, validation.username);
    const currentBest = current == null ? null : Number(current);
    if (currentBest == null || !Number.isFinite(currentBest) || timeMs < currentBest) {
      await command('ZADD', leaderboardKey, timeMs, validation.username);
    }

    return json({ ok: true, bestMs: currentBest == null ? timeMs : Math.min(currentBest, timeMs), leaderboard: await topEntries() });
  } catch (error) {
    return json({ error: error.message || 'Could not submit leaderboard result.' }, 503);
  }
}
