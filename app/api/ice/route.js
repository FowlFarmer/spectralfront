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

function staticMeteredIceServers() {
  const urls = process.env.METERED_TURN_URLS?.split(',').map(url => url.trim()).filter(Boolean) || [];
  const username = process.env.METERED_TURN_USERNAME?.trim();
  const credential = process.env.METERED_TURN_CREDENTIAL?.trim();
  return urls.length && username && credential ? [{ urls, username, credential }] : [];
}

async function meteredIceServers() {
  const endpoint = meteredEndpoint();
  if (!endpoint) return staticMeteredIceServers();
  try {
    const response = await fetch(endpoint, { cache: 'no-store' });
    if (!response.ok) {
      console.warn('[spectral-front:ice] metered_credential_fetch_failed', JSON.stringify({ status: response.status }));
      return staticMeteredIceServers();
    }
    const servers = validIceServers(await response.json());
    console.info('[spectral-front:ice] metered_credential_fetch_succeeded', JSON.stringify({ iceServerCount: servers.length }));
    return servers.length ? servers : staticMeteredIceServers();
  } catch (error) {
    console.warn('[spectral-front:ice] metered_credential_fetch_error', JSON.stringify({ reason: error.message }));
    return staticMeteredIceServers();
  }
}

export async function GET(request) {
  try {
    const value = await readTicket(new URL(request.url).searchParams.get('ticket'));
    if (!value || JSON.parse(value).status !== 'matched') return NextResponse.json({ error: 'Match expired.' }, { status: 401 });
    const meteredServers = await meteredIceServers();
    console.info('[spectral-front:ice] ice_config_issued', JSON.stringify({ match: String(JSON.parse(value).matchId).slice(0, 8), turnServerCount: meteredServers.length }));
    return NextResponse.json({ iceServers: [fallbackStun, ...meteredServers] }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}
