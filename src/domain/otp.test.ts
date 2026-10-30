import { describe, it, expect } from 'vitest';
import { base32Decode, base32Encode, buildOtpUri, parseOtpUri, computeOtp, readEntryOtp, totpTimeLeft } from './otp';

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

describe('OTP formats', () => {
  it('rejects a secret that is not base32', () => {
    expect(() => parseOtpUri('not a secret!')).toThrow();
    expect(() => parseOtpUri('otpauth://totp/x?secret=1189')).toThrow();
  });

  it('accepts a spaced, lowercase setup key', () => {
    expect(parseOtpUri('jbsw y3dp ehpk 3pxp').secret).toBe('JBSWY3DPEHPK3PXP');
  });

  it('keeps colons in the account part of the label', () => {
    const p = parseOtpUri('otpauth://totp/ACME%20Co:alice:work?secret=JBSWY3DP');
    expect(p.issuer).toBe('ACME Co');
    expect(p.account).toBe('alice:work');
  });

  it('parses the KeeOTP format', () => {
    const p = parseOtpUri('key=JBSWY3DP&step=60&size=8&otpHashMode=Sha256');
    expect(p).toMatchObject({ type: 'totp', secret: 'JBSWY3DP', period: 60, digits: 8, algorithm: 'SHA256' });
  });

  it('round-trips through buildOtpUri', () => {
    const p = parseOtpUri('otpauth://hotp/Git%20Hub:me%40x.com?secret=JBSWY3DP&issuer=Git%20Hub&counter=7&digits=8&algorithm=SHA512');
    expect(parseOtpUri(buildOtpUri(p))).toEqual(p);
  });

  it('base32Encode inverts base32Decode', () => {
    const bytes = [0, 1, 2, 250, 255, 128, 64];
    expect(Array.from(base32Decode(base32Encode(bytes)))).toEqual(bytes);
  });

  it('computes Steam Guard codes from the Steam alphabet', async () => {
    const p = parseOtpUri(`otpauth://totp/Steam:me?secret=${RFC_SECRET_BASE32}&encoder=steam`);
    const code = await computeOtp(p, 59_000);
    expect(code).toMatch(/^[23456789BCDFGHJKMNPQRTVWXY]{5}$/);
  });

  it('computes RFC 4226 HOTP values', async () => {
    const p = parseOtpUri(`otpauth://hotp/x?secret=${RFC_SECRET_BASE32}&counter=1`);
    expect(await computeOtp(p)).toBe('287082');
  });
});

describe('readEntryOtp', () => {
  const fields = (f: Record<string, string>) => (name: string) => f[name] ?? '';

  it('prefers the otp field', () => {
    expect(readEntryOtp(fields({ otp: 'otpauth://totp/x?secret=JBSWY3DP' }))).toBe('otpauth://totp/x?secret=JBSWY3DP');
  });

  it("reads KeePassXC's legacy seed and settings", () => {
    const p = parseOtpUri(readEntryOtp(fields({ 'TOTP Seed': 'JBSWY3DP', 'TOTP Settings': '60;8' }))!);
    expect(p).toMatchObject({ secret: 'JBSWY3DP', period: 60, digits: 8 });
    const steam = parseOtpUri(readEntryOtp(fields({ 'TOTP Seed': 'JBSWY3DP', 'TOTP Settings': '30;S' }))!);
    expect(steam.encoder).toBe('steam');
  });

  it("reads KeePass 2's TimeOtp fields in every secret encoding", async () => {
    const expected = await computeOtp(parseOtpUri(RFC_SECRET_BASE32), 59_000);
    const variants: Record<string, string>[] = [
      { 'TimeOtp-Secret': '12345678901234567890' },
      { 'TimeOtp-Secret-Hex': '3132333435363738393031323334353637383930' },
      { 'TimeOtp-Secret-Base32': RFC_SECRET_BASE32 },
      { 'TimeOtp-Secret-Base64': 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTA=' }
    ];
    for (const f of variants) {
      const p = parseOtpUri(readEntryOtp(fields(f))!);
      expect(await computeOtp(p, 59_000)).toBe(expected);
    }
    const p = parseOtpUri(readEntryOtp(fields({ 'TimeOtp-Secret-Base32': 'JBSWY3DP', 'TimeOtp-Length': '8', 'TimeOtp-Period': '60', 'TimeOtp-Algorithm': 'HMAC-SHA-256' }))!);
    expect(p).toMatchObject({ digits: 8, period: 60, algorithm: 'SHA256' });
  });

  it("reads KeePass 2's HmacOtp fields", () => {
    const p = parseOtpUri(readEntryOtp(fields({ 'HmacOtp-Secret-Base32': 'JBSWY3DP', 'HmacOtp-Counter': '4' }))!);
    expect(p).toMatchObject({ type: 'hotp', counter: 4 });
  });

  it('returns undefined without OTP fields', () => {
    expect(readEntryOtp(fields({ Title: 'x' }))).toBeUndefined();
  });
});
