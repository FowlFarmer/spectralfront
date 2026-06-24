import { NextResponse } from 'next/server';
import { readTicket } from '../../../lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const allowedEvents = new Set([
  'peer_created', 'ice_servers_received', 'ice_candidate', 'ice_gathering_complete', 'ice_gathering_state',
  'ice_connection_state', 'peer_connection_state', 'signaling_state', 'ice_candidate_error', 'selected_candidate_pair',
  'data_channel_received', 'data_channel_open', 'data_channel_close', 'data_channel_error', 'offer_sent', 'offer_received',
  'answer_sent', 'answer_received', 'remote_description_set', 'remote_candidate_received', 'remote_candidate_queued', 'remote_candidate_added', 'remote_candidate_error', 'signal_poll_error',
  'signal_send_error', 'peer_disconnected', 'peer_connection_error', 'match_transport_ready',
]);
const allowedDetailKeys = new Set(['state', 'candidateType', 'protocol', 'route', 'remoteCandidateType', 'channel', 'code', 'reason', 'iceServerCount', 'turnServerCount']);

function safeDetails(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key, detail]) => allowedDetailKeys.has(key) && ['string', 'number', 'boolean'].includes(typeof detail))
    .map(([key, detail]) => [key, typeof detail === 'string' ? detail.slice(0, 80) : detail]));
}

export async function POST(request) {
  try {
    const { ticket, event, details } = await request.json();
    if (!allowedEvents.has(event)) return NextResponse.json({ error: 'Invalid telemetry event.' }, { status: 400 });
    const value = await readTicket(ticket);
    const match = value && JSON.parse(value);
    if (!match || match.status !== 'matched') return NextResponse.json({ error: 'Match expired.' }, { status: 401 });
    console.info('[spectral-front:webrtc]', JSON.stringify({ event, match: String(match.matchId).slice(0, 8), role: match.role, details: safeDetails(details) }));
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}
