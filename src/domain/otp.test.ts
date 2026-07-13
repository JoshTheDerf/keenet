import { describe, it, expect } from 'vitest';
import { base32Decode, parseOtpUri, computeOtp, totpTimeLeft } from './otp';

// RFC 4648 / RFC 6238 test data. Secret = ASCII "12345678901234567890".
const RFC_SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('base32Decode', () => {
  it('decodes the RFC secret to the ASCII bytes', () => {
    const bytes = base32Decode(RFC_SECRET_BASE32);
    expect(new TextDecoder().decode(bytes)).toBe('12345678901234567890');
  });

  it('ignores padding and whitespace', () => {
    expect(base32Decode('JBSWY3DP').length).toBe(5); // "Hello"
    expect(new TextDecoder().decode(base32Decode('JBSW Y3DP==='))).toBe('Hello');
  });
});

describe('parseOtpUri', () => {
  it('parses a full otpauth URI', () => {
    const p = parseOtpUri(
      'otpauth://totp/ACME:alice@example.com?secret=JBSWY3DP&issuer=ACME&digits=6&period=30&algorithm=SHA1'
    );
    expect(p.type).toBe('totp');
    expect(p.secret).toBe('JBSWY3DP');
    expect(p.issuer).toBe('ACME');
    expect(p.account).toBe('alice@example.com');
    expect(p.digits).toBe(6);
    expect(p.period).toBe(30);
  });

  it('treats a bare secret as TOTP with defaults', () => {
    const p = parseOtpUri('JBSWY3DP');
    expect(p.type).toBe('totp');
    expect(p.secret).toBe('JBSWY3DP');
    expect(p.digits).toBe(6);
  });

  it('parses hotp with a counter', () => {
    const p = parseOtpUri('otpauth://hotp/x?secret=JBSWY3DP&counter=5');
    expect(p.type).toBe('hotp');
    expect(p.counter).toBe(5);
  });
});

describe('computeOtp (RFC 6238 vectors, SHA1, 8 digits)', () => {
  const params = {
    type: 'totp' as const,
    secret: RFC_SECRET_BASE32,
    algorithm: 'SHA1' as const,
    digits: 8,
    period: 30,
    counter: 0
  };

  it('T=59s → 94287082', async () => {
    expect(await computeOtp(params, 59 * 1000)).toBe('94287082');
  });

  it('T=1111111109s → 07081804', async () => {
    expect(await computeOtp(params, 1111111109 * 1000)).toBe('07081804');
  });

  it('T=1234567890s → 89005924', async () => {
    expect(await computeOtp(params, 1234567890 * 1000)).toBe('89005924');
  });
});

describe('totpTimeLeft', () => {
  it('returns seconds until the next window', () => {
    expect(totpTimeLeft(30, 0)).toBe(30);
    expect(totpTimeLeft(30, 10_000)).toBe(20);
    expect(totpTimeLeft(30, 29_000)).toBe(1);
  });
});
