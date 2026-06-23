import { command, readTicket, reply } from './_kv.js';

const ticketValid = value => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
const joinScript = `
local queued = redis.call('GET', KEYS[1])
if queued and queued ~= ARGV[1] then
  redis.call('DEL', KEYS[1])
  redis.call('SET', KEYS[2], ARGV[2], 'EX', 3600)
  redis.call('SET', 'sf:ticket:' .. queued, ARGV[3], 'EX', 3600)
  redis.call('SET', 'sf:ticket:' .. ARGV[1], ARGV[4], 'EX', 3600)
  return {'matched', queued}
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', 90)
redis.call('SET', 'sf:ticket:' .. ARGV[1], ARGV[5], 'EX', 95)
return {'waiting'}
`;
const cancelScript = `if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]) end redis.call('DEL', KEYS[2]) return 1`;

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') { const value = await readTicket(req.query.ticket); return reply(res, 200, value ? JSON.parse(value) : { status: 'expired' }); }
    const { ticket } = req.body || {}; if (!ticketValid(ticket)) return reply(res, 400, { error: 'Invalid match ticket.' });
    if (req.method === 'DELETE') { await command('EVAL', cancelScript, 2, 'sf:queue', `sf:ticket:${ticket}`, ticket); return reply(res, 200, { ok: true }); }
    if (req.method !== 'POST') return reply(res, 405, { error: 'Method not allowed.' });
    const matchId = crypto.randomUUID();
    const game = JSON.stringify({ id: matchId, createdAt: Date.now() });
    const host = JSON.stringify({ status: 'matched', matchId, role: 'host' });
    const guest = JSON.stringify({ status: 'matched', matchId, role: 'guest' });
    const waiting = JSON.stringify({ status: 'waiting' });
    const result = await command('EVAL', joinScript, 2, 'sf:queue', `sf:match:${matchId}`, ticket, game, host, guest, waiting);
    return reply(res, 200, { status: result[0] === 'matched' ? 'matched' : 'waiting' });
  } catch (error) { return reply(res, 503, { error: error.message }); }
}
