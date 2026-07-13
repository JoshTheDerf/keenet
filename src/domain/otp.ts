/**
 * TOTP / HOTP implementation (RFC 6238 / RFC 4226) using Web Crypto HMAC.
 * Parses `otpauth://` URIs as stored by KeePass/KeeWeb.
 */

export interface OtpParams {
  type: 'totp' | 'hotp';
  secret: string; // base32
  algorithm: 'SHA1' | 'SHA256' | 'SHA512';
  digits: number;
  period: number; // seconds (totp)
  counter: number; // (hotp)
  issuer?: string;
  account?: string;
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

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

const DEFAULTS: Omit<OtpParams, 'secret' | 'type'> = {
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
  counter: 0
};

/** Parse an otpauth:// URI into OtpParams. Throws on malformed input. */
export function parseOtpUri(uri: string): OtpParams {
  if (!/^otpauth:\/\//i.test(uri)) {
    // Bare secret — treat as TOTP with defaults.
    return { type: 'totp', secret: uri.trim(), ...DEFAULTS };
  }
  const url = new URL(uri);
  const type = (url.host || url.pathname.replace(/^\/\//, '').split('/')[0]).toLowerCase();
  const label = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const params = url.searchParams;
  const secret = params.get('secret');
  if (!secret) throw new Error('otpauth URI missing secret');

  let issuer = params.get('issuer') || undefined;
  let account = label;
  if (label.includes(':')) {
    const [iss, acc] = label.split(':');
    issuer = issuer || iss;
    account = acc;
  }

  return {
    type: type === 'hotp' ? 'hotp' : 'totp',
    secret,
    algorithm: (params.get('algorithm')?.toUpperCase() as OtpParams['algorithm']) || DEFAULTS.algorithm,
    digits: parseInt(params.get('digits') || '', 10) || DEFAULTS.digits,
    period: parseInt(params.get('period') || '', 10) || DEFAULTS.period,
    counter: parseInt(params.get('counter') || '', 10) || DEFAULTS.counter,
    issuer,
    account
  };
}

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

/** Compute an OTP code for a given counter value (or time for TOTP). */
export async function computeOtp(params: OtpParams, atMillis: number = Date.now()): Promise<string> {
  const key = base32Decode(params.secret);
  const counter = params.type === 'hotp' ? params.counter : Math.floor(atMillis / 1000 / params.period);
  const digest = await hmac(key, counterToBytes(counter), params.algorithm);
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  const code = binary % 10 ** params.digits;
  return code.toString().padStart(params.digits, '0');
}

/** Seconds remaining in the current TOTP window. */
export function totpTimeLeft(period: number, atMillis: number = Date.now()): number {
  return period - (Math.floor(atMillis / 1000) % period);
}
