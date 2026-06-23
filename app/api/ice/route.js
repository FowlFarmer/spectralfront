import { NextResponse } from 'next/server';
import { readTicket } from '../../../lib/kv';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function GET(request) { try { const value = await readTicket(new URL(request.url).searchParams.get('ticket')); if (!value || JSON.parse(value).status !== 'matched') return NextResponse.json({ error: 'Match expired.' }, { status: 401 }); const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }]; return NextResponse.json({ iceServers }, { headers: { 'Cache-Control': 'no-store' } }); } catch (error) { return NextResponse.json({ error: error.message }, { status: 503 }); } }
