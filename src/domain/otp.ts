/**
 * TOTP / HOTP implementation (RFC 6238 / RFC 4226) using Web Crypto HMAC.
 * Parses `otpauth://` URIs as stored by KeePassXC/KeeWeb, and reads the other
 * on-disk conventions (KeePassXC's legacy TOTP Seed/Settings pair, KeePass
 * 2.47+'s TimeOtp and HmacOtp fields) so every entry shows its code.
 */

export interface OtpParams {
  type: 'totp' | 'hotp';
  secret: string; // base32
  algorithm: 'SHA1' | 'SHA256' | 'SHA512';
  digits: number;
  period: number; // seconds (totp)
  counter: number; // (hotp)
  /** 'steam' renders Steam Guard's 5-character codes */
  encoder?: 'steam';
  issuer?: string;
  account?: string;
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEAM_ALPHABET = '23456789BCDFGHJKMNPQRTVWXY';

export function base32Decode(input: string): Uint8Array<ArrayBuffer> {
  const clean = input.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((value >>> bits) & 0xff);
    }
  }
  return new Uint8Array(output);
}

export function base32Encode(bytes: ArrayLike<number>): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | (bytes[i] & 0xff);
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(value >>> bits) & 31];
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Normalize a typed or pasted secret: drop spaces/dashes/padding, uppercase. */
export function normalizeSecret(secret: string): string {
  return secret.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
}

/** True when the secret is non-empty base32 that decodes to at least one byte. */
export function isValidSecret(secret: string): boolean {
  const s = normalizeSecret(secret);
  return s.length >= 2 && /^[A-Z2-7]+$/.test(s);
}

const DEFAULTS: Omit<OtpParams, 'secret' | 'type'> = {
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
  counter: 0
};

function parseAlgorithm(value: string | null | undefined): OtpParams['algorithm'] {
  const v = (value ?? '').toUpperCase().replace(/^HMAC-?/, '').replace('-', '');
  return v === 'SHA256' || v === 'SHA512' ? v : 'SHA1';
}

/** Parse an otpauth:// URI (or a bare base32 secret) into OtpParams. Throws on malformed input. */
export function parseOtpUri(uri: string): OtpParams {
  const raw = uri.trim();
  if (/^key=/i.test(raw)) return parseKeeOtp(raw);
  if (!/^otpauth:\/\//i.test(raw)) {
    // Bare secret — treat as TOTP with defaults.
    if (!isValidSecret(raw)) throw new Error('Not a valid one-time code secret');
    return { type: 'totp', secret: normalizeSecret(raw), ...DEFAULTS };
  }
  const url = new URL(raw);
  const type = (url.host || url.pathname.replace(/^\/\//, '').split('/')[0]).toLowerCase();
  const path = url.host ? url.pathname : url.pathname.replace(/^\/\/[^/]*/, '');
  const label = safeDecode(path.replace(/^\//, ''));
  const params = url.searchParams;
  const secret = params.get('secret');
  if (!secret || !isValidSecret(secret)) throw new Error('otpauth URI missing secret');

  let issuer = params.get('issuer') || undefined;
  let account = label;
  const colon = label.indexOf(':');
  if (colon !== -1) {
    issuer = issuer || label.slice(0, colon).trim();
    account = label.slice(colon + 1).trim();
  }
  const encoder = params.get('encoder')?.toLowerCase() === 'steam';

  const digits = parseInt(params.get('digits') || '', 10);
  return {
    type: type === 'hotp' ? 'hotp' : 'totp',
    secret: normalizeSecret(secret),
    algorithm: parseAlgorithm(params.get('algorithm')),
    digits: encoder ? 5 : digits >= 1 && digits <= 10 ? digits : DEFAULTS.digits,
    period: parseInt(params.get('period') || '', 10) || DEFAULTS.period,
    counter: parseInt(params.get('counter') || '', 10) || DEFAULTS.counter,
    ...(encoder ? { encoder: 'steam' as const } : {}),
    issuer: issuer || undefined,
    account: account || undefined
  };
}

/** KeeOTP plugin format, which KeePassXC also reads: key=BASE32&step=30&size=6&otpHashMode=Sha256 */
function parseKeeOtp(raw: string): OtpParams {
  const q = new URLSearchParams(raw);
  const secret = q.get('key') ?? '';
  if (!isValidSecret(secret)) throw new Error('Not a valid one-time code secret');
  const hotp = q.get('type')?.toLowerCase() === 'hotp';
  return {
    type: hotp ? 'hotp' : 'totp',
    secret: normalizeSecret(secret),
    algorithm: parseAlgorithm(q.get('otpHashMode')),
    digits: parseInt(q.get('size') || '', 10) || DEFAULTS.digits,
    period: parseInt(q.get('step') || '', 10) || DEFAULTS.period,
    counter: parseInt(q.get('counter') || '', 10) || DEFAULTS.counter
  };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Build a canonical otpauth:// URI (what KeePassXC writes to the `otp` field). */
export function buildOtpUri(p: OtpParams): string {
  const label = [p.issuer, p.account].filter(Boolean).map((s) => encodeURIComponent(s!)).join(':');
  const q = new URLSearchParams();
  q.set('secret', normalizeSecret(p.secret));
  if (p.issuer) q.set('issuer', p.issuer);
  if (p.algorithm !== 'SHA1') q.set('algorithm', p.algorithm);
  if (p.encoder === 'steam') q.set('encoder', 'steam');
  else if (p.digits !== 6) q.set('digits', String(p.digits));
  if (p.type === 'totp' && p.period !== 30) q.set('period', String(p.period));
  if (p.type === 'hotp') q.set('counter', String(p.counter));
  return `otpauth://${p.type}/${label || 'KeeNet'}?${q.toString().replace(/\+/g, '%20')}`;
}

// ---- reading OTP settings stored on an entry --------------------------------

/** Field names that hold OTP configuration, in any of the supported conventions. */
export const OTP_FIELD_NAMES = [
  'otp',
  'TOTP Seed',
  'TOTP Settings',
  'TimeOtp-Secret',
  'TimeOtp-Secret-Hex',
  'TimeOtp-Secret-Base32',
  'TimeOtp-Secret-Base64',
  'TimeOtp-Length',
  'TimeOtp-Period',
  'TimeOtp-Algorithm',
  'HmacOtp-Secret',
  'HmacOtp-Secret-Hex',
  'HmacOtp-Secret-Base32',
  'HmacOtp-Secret-Base64',
  'HmacOtp-Counter'
];

function hexToBytes(hex: string): number[] {
  const clean = hex.replace(/[^0-9a-f]/gi, '');
  const out: number[] = [];
  for (let i = 0; i + 1 < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16));
  return out;
}

function kpSecret(get: (name: string) => string, prefix: 'TimeOtp' | 'HmacOtp'): string {
  const b32 = get(`${prefix}-Secret-Base32`);
  if (b32) return normalizeSecret(b32);
  const hex = get(`${prefix}-Secret-Hex`);
  if (hex) return base32Encode(hexToBytes(hex));
  const b64 = get(`${prefix}-Secret-Base64`);
  if (b64) {
    try {
      return base32Encode(Array.from(atob(b64.trim()), (c) => c.charCodeAt(0)));
    } catch {
      return '';
    }
  }
  const utf8 = get(`${prefix}-Secret`);
  return utf8 ? base32Encode(new TextEncoder().encode(utf8)) : '';
}

/**
 * The entry's OTP as an otpauth:// URI (or the raw `otp` value), from whichever
 * convention the database uses. Undefined when the entry has no OTP.
 */
export function readEntryOtp(get: (name: string) => string): string | undefined {
  const otp = get('otp').trim();
  if (otp) return otp;

  // KeePassXC < 2.6: "TOTP Seed" + "TOTP Settings" = "period;digits" or "period;S" (Steam)
  const seed = get('TOTP Seed').trim();
  if (seed) {
    const [period, digits] = get('TOTP Settings').split(';');
    const steam = digits?.trim().toUpperCase() === 'S';
    return buildOtpUri({
      type: 'totp',
      secret: seed,
      algorithm: 'SHA1',
      digits: steam ? 5 : parseInt(digits, 10) || 6,
      period: parseInt(period, 10) || 30,
      counter: 0,
      ...(steam ? { encoder: 'steam' as const } : {})
    });
  }

  // KeePass 2.47+: TimeOtp-* / HmacOtp-*
  const time = kpSecret(get, 'TimeOtp');
  if (time) {
    return buildOtpUri({
      type: 'totp',
      secret: time,
      algorithm: parseAlgorithm(get('TimeOtp-Algorithm')),
      digits: parseInt(get('TimeOtp-Length'), 10) || 6,
      period: parseInt(get('TimeOtp-Period'), 10) || 30,
      counter: 0
    });
  }
  const hmac = kpSecret(get, 'HmacOtp');
  if (hmac) {
    return buildOtpUri({
      type: 'hotp',
      secret: hmac,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      counter: parseInt(get('HmacOtp-Counter'), 10) || 0
    });
  }
  return undefined;
}

/** True when the entry stores its code in KeePass 2's own TimeOtp/HmacOtp fields. */
export function usesKeePass2Fields(has: (name: string) => boolean): boolean {
  return OTP_FIELD_NAMES.some((n) => /^(TimeOtp|HmacOtp)-/.test(n) && has(n));
}

/** KeePass 2.47+'s fields for these params (it doesn't read the `otp` URI). */
export function keePass2Fields(p: OtpParams): Record<string, string> {
  if (p.type === 'hotp') {
    return { 'HmacOtp-Secret-Base32': p.secret, 'HmacOtp-Counter': String(p.counter) };
  }
  const fields: Record<string, string> = { 'TimeOtp-Secret-Base32': p.secret };
  if (p.digits !== 6) fields['TimeOtp-Length'] = String(p.digits);
  if (p.period !== 30) fields['TimeOtp-Period'] = String(p.period);
  if (p.algorithm !== 'SHA1') fields['TimeOtp-Algorithm'] = `HMAC-SHA-${p.algorithm.slice(3)}`;
  return fields;
}

// ---- code generation ---------------------------------------------------------

function hmacName(alg: OtpParams['algorithm']): string {
  return { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' }[alg];
}

async function hmac(
  key: Uint8Array<ArrayBuffer>,
  msg: Uint8Array<ArrayBuffer>,
  alg: OtpParams['algorithm']
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: hmacName(alg) },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msg);
  return new Uint8Array(sig);
}

function counterToBytes(counter: number): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(8);
  let value = Math.floor(counter);
  for (let i = 7; i >= 0; i--) {
    buf[i] = value & 0xff;
    value = Math.floor(value / 256);
  }
  return buf;
}

/** The moving factor: the HOTP counter, or the TOTP time step at `atMillis`. */
export function otpCounter(params: OtpParams, atMillis: number = Date.now()): number {
  return params.type === 'hotp' ? params.counter : Math.floor(atMillis / 1000 / params.period);
}

/** Compute an OTP code for a given counter value (or time for TOTP). */
export async function computeOtp(params: OtpParams, atMillis: number = Date.now()): Promise<string> {
  const key = base32Decode(params.secret);
  const digest = await hmac(key, counterToBytes(otpCounter(params, atMillis)), params.algorithm);
  const offset = digest[digest.length - 1] & 0x0f;
  let binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  if (params.encoder === 'steam') {
    let code = '';
    for (let i = 0; i < 5; i++) {
      code += STEAM_ALPHABET[binary % STEAM_ALPHABET.length];
      binary = Math.floor(binary / STEAM_ALPHABET.length);
    }
    return code;
  }
  // digits up to 10: 2^31 has 10 digits, so modulo is exact without BigInt
  const code = binary % 10 ** params.digits;
  return code.toString().padStart(params.digits, '0');
}

/** Seconds remaining in the current TOTP window. */
export function totpTimeLeft(period: number, atMillis: number = Date.now()): number {
  return period - (Math.floor(atMillis / 1000) % period);
}

/** "123456" → "123 456", for reading aloud / typing from another device. */
export function formatOtpCode(code: string): string {
  if (!code || code.length < 6 || !/^\d+$/.test(code)) return code;
  const mid = Math.ceil(code.length / 2);
  return `${code.slice(0, mid)} ${code.slice(mid)}`;
}

/** The parsed params, or null when the value isn't a usable OTP setup. */
export function tryParseOtp(value: string | undefined): OtpParams | null {
  if (!value) return null;
  try {
    return parseOtpUri(value);
  } catch {
    return null;
  }
}

/** Compute the current code for a stored OTP value, or '' when it can't be. */
export async function currentOtp(value: string | undefined): Promise<string> {
  const p = tryParseOtp(value);
  return p ? computeOtp(p) : '';
}
