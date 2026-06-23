import { command, readTicket, reply } from './_kv.js';

const drain = `local v=redis.call('LRANGE',KEYS[1],0,-1) redis.call('DEL',KEYS[1]) return v`;
export default async function handler(req, res) {
  try {
    const ticket = req.method === 'GET' ? req.query.ticket : req.body?.ticket;
    const ticketValue = await readTicket(ticket); if (!ticketValue) return reply(res, 401, { error: 'Match expired.' });
    const player = JSON.parse(ticketValue); if (player.status !== 'matched') return reply(res, 409, { error: 'Match is not ready.' });
    const key = `sf:signal:${player.matchId}:${player.role}`;
    if (req.method === 'GET') { const values = await command('EVAL', drain, 1, key); return reply(res, 200, { messages: values.map(JSON.parse) }); }
    if (req.method !== 'POST') return reply(res, 405, { error: 'Method not allowed.' });
    const message = req.body?.message; if (!message || !['offer','answer','candidate','peer-left'].includes(message.type) || JSON.stringify(message).length > 20000) return reply(res, 400, { error: 'Invalid signal.' });
    const target = player.role === 'host' ? 'guest' : 'host'; await command('RPUSH', `sf:signal:${player.matchId}:${target}`, JSON.stringify(message)); await command('EXPIRE', `sf:signal:${player.matchId}:${target}`, 3600); return reply(res, 200, { ok: true });
  } catch (error) { return reply(res, 503, { error: error.message }); }
}
