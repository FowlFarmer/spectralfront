import { NextResponse } from 'next/server';
import { readTicket } from '../../../lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fallbackStun = { urls: 'stun:stun.l.google.com:19302' };

function meteredEndpoint() {
  const domain = process.env.METERED_TURN_DOMAIN?.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const apiKey = process.env.METERED_TURN_API_KEY?.trim();
  if (!domain || !apiKey) return null;
  const endpoint = new URL(`/api/v1/turn/credentials`, `https://${domain}`);
  endpoint.searchParams.set('apiKey', apiKey);
  if (process.env.METERED_TURN_REGION?.trim()) endpoint.searchParams.set('region', process.env.METERED_TURN_REGION.trim());
  return endpoint;
}

function validIceServers(payload) {
  const candidates = Array.isArray(payload) ? payload : payload?.iceServers;
  if (!Array.isArray(candidates)) return [];
  return candidates.filter(server => server && typeof server === 'object' && (typeof server.urls === 'string' || Array.isArray(server.urls)));
}

async function meteredIceServers() {
  const endpoint = meteredEndpoint();
  if (!endpoint) return [];
  try {
    const response = await fetch(endpoint, { cache: 'no-store' });
    if (!response.ok) return [];
    return validIceServers(await response.json());
  } catch {
    return [];
  }
}

export async function GET(request) {
  try {
    const value = await readTicket(new URL(request.url).searchParams.get('ticket'));
    if (!value || JSON.parse(value).status !== 'matched') return NextResponse.json({ error: 'Match expired.' }, { status: 401 });
    const meteredServers = await meteredIceServers();
    return NextResponse.json({ iceServers: [fallbackStun, ...meteredServers] }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}
