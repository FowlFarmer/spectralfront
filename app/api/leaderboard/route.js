import { NextResponse } from 'next/server';
import { command } from '../../../lib/kv';
import { validateUsername } from '../../../lib/usernames';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const leaderboardKey = 'sf:leaderboard:onslaught-destroyed';
const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

function parseLeaderboard(rows) {
  const entries = [];
  for (let index = 0; index < rows.length; index += 2) {
    const username = rows[index], kills = Number(rows[index + 1]);
    if (username && Number.isFinite(kills)) entries.push({ rank: entries.length + 1, username, kills });
  }
  return entries;
}

async function topEntries() {
  return parseLeaderboard(await command('ZREVRANGE', leaderboardKey, 0, 9, 'WITHSCORES'));
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
    const { username: rawUsername, kills: rawKills } = await request.json();
    const validation = validateUsername(rawUsername);
    const kills = Math.round(Number(rawKills));
    if (!validation.ok) return json({ error: validation.error }, 400);
    if (!Number.isFinite(kills) || kills < 0 || kills > 10000) return json({ error: 'Invalid onslaught score.' }, 400);

    const current = await command('ZSCORE', leaderboardKey, validation.username);
    const currentBest = current == null ? null : Number(current);
    if (currentBest == null || !Number.isFinite(currentBest) || kills > currentBest) {
      await command('ZADD', leaderboardKey, kills, validation.username);
    }

    return json({ ok: true, bestKills: currentBest == null ? kills : Math.max(currentBest, kills), leaderboard: await topEntries() });
  } catch (error) {
    return json({ error: error.message || 'Could not submit onslaught result.' }, 503);
  }
}
