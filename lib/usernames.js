export const USERNAME_STORAGE_KEY = 'spectral-front-username';

const usernamePattern = /^[A-Za-z0-9 _-]{3,18}$/;
const profanityPattern = /\b(?:a+s+s+|a+ssh+o+l+e+|b+i+t+c+h+|b+a+s+t+a+r+d+|c+u+n+t+|d+i+c+k+|f+u+c+k+|f+a+g+|f+a+g+g+o+t+|n+i+g+g+e+r+|n+i+g+g+a+|k+i+k+e+|r+e+t+a+r+d+|s+h+i+t+|s+l+u+t+|w+h+o+r+e+)\b/i;
const condensedProfanityPattern = /(?:4ss|a55|b1tch|cunt|d1ck|f+u+c+k+|f4g|n1gg|nigg|r3tard|sh1t|slut|wh0re)/i;

export function normalizeUsername(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function validateUsername(value) {
  const username = normalizeUsername(value);
  if (!username) return { ok: false, username, error: 'Choose a commander name.' };
  if (username.length < 3) return { ok: false, username, error: 'Use at least 3 characters.' };
  if (username.length > 18) return { ok: false, username, error: 'Keep it 18 characters or fewer.' };
  if (!usernamePattern.test(username)) return { ok: false, username, error: 'Use letters, numbers, spaces, _ or - only.' };
  const compact = username.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't');
  if (profanityPattern.test(username) || profanityPattern.test(compact) || condensedProfanityPattern.test(compact)) return { ok: false, username, error: 'That commander name is not allowed.' };
  return { ok: true, username, error: '' };
}
