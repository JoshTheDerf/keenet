import { describe, it, expect } from 'vitest';
import { parseOtpImport, OtpImportFormatError } from './otp-import';
import { parseOtpUri } from './otp';
import { otpTokensFromQr } from './qr';

// "12345678901234567890" as Java signed bytes, the way FreeOTP stores secrets
const SECRET_BYTES = Array.from('12345678901234567890', (c) => c.charCodeAt(0));
const SECRET_B32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('parseOtpImport (FreeOTP)', () => {
  const backup = {
    tokenOrder: ['Beta:bob', 'Alpha:alice@example.com'],
    tokens: [
      { algo: 'SHA1', counter: 0, digits: 6, issuerExt: 'Alpha', label: 'alice@example.com', period: 30, secret: SECRET_BYTES, type: 'TOTP' },
      { algo: 'SHA256', counter: 3, digits: 8, issuerExt: 'Beta', issuerInt: 'Beta', issuerAlt: 'Beta Bank', label: 'bob', period: 30, secret: [-1, -128, 0, 127, 5], type: 'HOTP' }
    ]
  };

  it('converts tokens to otpauth URIs in the app order', () => {
    const tokens = parseOtpImport(JSON.stringify(backup));
    expect(tokens.map((t) => t.issuer)).toEqual(['Beta Bank', 'Alpha']);
    const alpha = parseOtpUri(tokens[1].uri);
    expect(alpha).toMatchObject({ type: 'totp', secret: SECRET_B32, issuer: 'Alpha', account: 'alice@example.com', digits: 6 });
    const beta = parseOtpUri(tokens[0].uri);
    expect(beta).toMatchObject({ type: 'hotp', counter: 3, digits: 8, algorithm: 'SHA256', account: 'bob' });
  });

  it('maps signed bytes to unsigned', () => {
    const beta = parseOtpUri(parseOtpImport(JSON.stringify(backup))[0].uri);
    expect(beta.secret).toBe('76AAA7YF');
  });

  it('skips tokens without a secret but keeps the rest', () => {
    const data = { tokens: [{ issuerExt: 'X', label: 'y', type: 'TOTP' }, backup.tokens[0]] };
    expect(parseOtpImport(JSON.stringify(data))).toHaveLength(1);
  });

  it('reads a list of otpauth links', () => {
    const text = `otpauth://totp/A:a?secret=JBSWY3DP\n\notpauth://totp/B:b?secret=${SECRET_B32}&issuer=B\n`;
    expect(parseOtpImport(text).map((t) => [t.issuer, t.account])).toEqual([['A', 'a'], ['B', 'b']]);
  });

  it('rejects other files', () => {
    expect(() => parseOtpImport('{"entries": []}')).toThrow(OtpImportFormatError);
    expect(() => parseOtpImport('hello')).toThrow(OtpImportFormatError);
  });
});

// protobuf writer for Google Authenticator's migration payload
function varint(n: number): number[] {
  const out: number[] = [];
  while (n > 127) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
}
const bytesField = (f: number, b: number[]) => [...varint((f << 3) | 2), ...varint(b.length), ...b];
const intField = (f: number, n: number) => [...varint(f << 3), ...varint(n)];
const str = (s: string) => Array.from(new TextEncoder().encode(s));

describe('otpTokensFromQr', () => {
  it('reads a plain otpauth code', () => {
    expect(otpTokensFromQr('otpauth://totp/A:a?secret=JBSWY3DP')).toHaveLength(1);
    expect(otpTokensFromQr('https://example.com')).toEqual([]);
  });

  it('reads a Google Authenticator export', () => {
    const otp1 = [...bytesField(1, SECRET_BYTES), ...bytesField(2, str('Alpha:alice')), ...bytesField(3, str('Alpha')), ...intField(4, 1), ...intField(5, 1), ...intField(6, 2)];
    const otp2 = [...bytesField(1, [1, 2, 3, 4, 5]), ...bytesField(2, str('bob')), ...intField(5, 2), ...intField(6, 1), ...intField(7, 9)];
    const payload = [...bytesField(1, otp1), ...bytesField(1, otp2), ...intField(2, 1), ...intField(3, 1)];
    const data = btoa(String.fromCharCode(...payload));
    const tokens = otpTokensFromQr(`otpauth-migration://offline?data=${encodeURIComponent(data)}`);
    expect(tokens).toHaveLength(2);
    expect(parseOtpUri(tokens[0].uri)).toMatchObject({ secret: SECRET_B32, issuer: 'Alpha', account: 'alice', type: 'totp' });
    expect(parseOtpUri(tokens[1].uri)).toMatchObject({ type: 'hotp', counter: 9, digits: 8, account: 'bob' });
  });
});
