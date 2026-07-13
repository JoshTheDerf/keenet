/**
 * Have I Been Pwned — password breach check via the k-anonymity range API.
 * Only the first 5 hex chars of the SHA-1 are ever sent; the suffix is matched
 * locally, so the plaintext password never leaves the device.
 */

const RANGE_URL = 'https://api.pwnedpasswords.com/range/';

async function sha1Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/** Returns how many times the password appears in breaches (0 = not found). */
export async function checkPwned(password: string): Promise<number> {
  if (!password) return 0;
  const hash = await sha1Hex(password);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  const res = await fetch(RANGE_URL + prefix, {
    headers: { 'Add-Padding': 'true' }
  });
  if (!res.ok) throw new Error(`HIBP request failed: ${res.status}`);
  const body = await res.text();
  for (const line of body.split('\n')) {
    const [suf, count] = line.trim().split(':');
    if (suf === suffix) return parseInt(count, 10) || 0;
  }
  return 0;
}

/** Check many passwords, de-duplicating identical ones. Returns id → count>0. */
export async function checkManyPwned(
  items: { id: string; password: string }[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const uniquePasswords = new Map<string, string[]>(); // password → ids
  for (const item of items) {
    if (!item.password) continue;
    const ids = uniquePasswords.get(item.password) ?? [];
    ids.push(item.id);
    uniquePasswords.set(item.password, ids);
  }
  for (const [password, ids] of uniquePasswords) {
    try {
      const count = await checkPwned(password);
      if (count > 0) for (const id of ids) result.set(id, count);
    } catch {
      // network error — skip this password
    }
  }
  return result;
}
