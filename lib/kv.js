const endpoint = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

export async function command(...args) {
  if (!endpoint || !token) throw new Error('Matchmaking is not configured. Connect Upstash Redis.');
  const response = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(args), cache: 'no-store' });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(body.error || 'KV request failed');
  return body.result;
}
export const readTicket = ticket => ticket ? command('GET', `sf:ticket:${ticket}`) : null;
