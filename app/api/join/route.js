import { NextResponse } from 'next/server';
import { command, readTicket } from '../../../lib/kv';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
const valid = value => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
const validCode = value => typeof value === 'string' && /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(value);
const joinScript = `local q=redis.call('GET',KEYS[1]) if q and q~=ARGV[1] then redis.call('DEL',KEYS[1]) redis.call('SET',KEYS[2],ARGV[2],'EX',3600) redis.call('SET','sf:ticket:'..q,ARGV[3],'EX',3600) redis.call('SET','sf:ticket:'..ARGV[1],ARGV[4],'EX',3600) return {'matched'} end redis.call('SET',KEYS[1],ARGV[1],'EX',90) redis.call('SET','sf:ticket:'..ARGV[1],ARGV[5],'EX',95) return {'waiting'}`;
const privateCreateScript = `if redis.call('SET',KEYS[1],ARGV[1],'NX','EX',600) then redis.call('SET',KEYS[2],ARGV[2],'EX',605) return 1 end return 0`;
const privateJoinScript = `local host=redis.call('GET',KEYS[1]) if not host then return {'not-found'} end if host==ARGV[1] then return {'invalid'} end redis.call('DEL',KEYS[1]) redis.call('SET',KEYS[2],ARGV[2],'EX',3600) redis.call('SET','sf:ticket:'..host,ARGV[3],'EX',3600) redis.call('SET','sf:ticket:'..ARGV[1],ARGV[4],'EX',3600) return {'matched'}`;
const cancelScript = `if redis.call('GET',KEYS[1])==ARGV[1] then redis.call('DEL',KEYS[1]) end local ticket=redis.call('GET',KEYS[2]) if ticket then local decoded=cjson.decode(ticket) if decoded.privateCode then redis.call('DEL','sf:private:'..decoded.privateCode) end end redis.call('DEL',KEYS[2]) return 1`;
const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET(request) { try { const value = await readTicket(new URL(request.url).searchParams.get('ticket')); return json(value ? JSON.parse(value) : { status: 'expired' }); } catch (error) { return json({ error: error.message }, 503); } }
export async function POST(request) { try { const { ticket, mode = 'public', code } = await request.json(); if (!valid(ticket)) return json({ error: 'Invalid match ticket.' }, 400);
  if (mode === 'private-create') {
    for (let attempt = 0; attempt < 5; attempt += 1) { const privateCode = crypto.randomUUID().replace(/[^A-Z0-9]/gi, '').toUpperCase().replace(/[01ILO]/g, '').slice(0, 6); const created = await command('EVAL', privateCreateScript, 2, `sf:private:${privateCode}`, `sf:ticket:${ticket}`, ticket, JSON.stringify({ status: 'waiting', privateCode })); if (created === 1) return json({ status: 'waiting', code: privateCode }); }
    return json({ error: 'Could not reserve a private lobby code. Please try again.' }, 503);
  }
  if (mode === 'private-join') {
    const privateCode = String(code || '').trim().toUpperCase(); if (!validCode(privateCode)) return json({ error: 'Enter the six-character lobby code.' }, 400);
    const matchId = crypto.randomUUID(); const result = await command('EVAL', privateJoinScript, 2, `sf:private:${privateCode}`, `sf:match:${matchId}`, ticket, JSON.stringify({ id: matchId, createdAt: Date.now(), privateCode }), JSON.stringify({ status: 'matched', matchId, role: 'host' }), JSON.stringify({ status: 'matched', matchId, role: 'guest' }));
    if (result[0] !== 'matched') return json({ error: result[0] === 'not-found' ? 'That lobby code is unavailable or has expired.' : 'You cannot join your own lobby.' }, 404); return json({ status: 'matched' });
  }
  if (mode !== 'public') return json({ error: 'Invalid matchmaking mode.' }, 400);
  const matchId = crypto.randomUUID(); const result = await command('EVAL', joinScript, 2, 'sf:queue', `sf:match:${matchId}`, ticket, JSON.stringify({ id: matchId, createdAt: Date.now() }), JSON.stringify({ status: 'matched', matchId, role: 'host' }), JSON.stringify({ status: 'matched', matchId, role: 'guest' }), JSON.stringify({ status: 'waiting' })); return json({ status: result[0] });
} catch (error) { return json({ error: error.message }, 503); } }
export async function DELETE(request) { try { const { ticket } = await request.json(); if (!valid(ticket)) return json({ error: 'Invalid match ticket.' }, 400); await command('EVAL', cancelScript, 2, 'sf:queue', `sf:ticket:${ticket}`, ticket); return json({ ok: true }); } catch (error) { return json({ error: error.message }, 503); } }
