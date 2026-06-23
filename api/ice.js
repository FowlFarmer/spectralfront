import { readTicket, reply } from './_kv.js';

export default async function handler(req, res) {
  try {
    const value = await readTicket(req.query.ticket); if (!value || JSON.parse(value).status !== 'matched') return reply(res, 401, { error: 'Match expired.' });
    const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) iceServers.push({ urls: process.env.TURN_URL, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
    return reply(res, 200, { iceServers });
  } catch (error) { return reply(res, 503, { error: error.message }); }
}
