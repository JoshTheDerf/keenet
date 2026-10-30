/**
 * One-time code imports: FreeOTP / FreeOTP+ JSON backups and plain lists of
 * otpauth:// URIs (one per line, as most authenticator apps can export).
 * Each token becomes an otpauth URI plus the issuer/account to title an entry.
 */
import { base32Encode, buildOtpUri, isValidSecret, parseOtpUri, type OtpParams } from '@/domain/otp';

export interface ImportedToken {
  issuer: string;
  account: string;
  uri: string;
}

interface FreeOtpToken {
  algo?: string;
  counter?: number;
  digits?: number;
  period?: number;
  secret?: number[] | string;
  type?: string;
  label?: string;
  labelAlt?: string;
  issuerExt?: string;
  issuerInt?: string;
  issuerAlt?: string;
}

function freeOtpToken(t: FreeOtpToken): ImportedToken {
  // FreeOTP stores the secret as Java signed bytes; some forks store base32.
  const secret = Array.isArray(t.secret) ? base32Encode(t.secret.map((b) => b & 0xff)) : String(t.secret ?? '');
  if (!isValidSecret(secret)) throw new Error('Token has no usable secret');
  const algo = String(t.algo ?? 'SHA1').toUpperCase();
  const issuer = (t.issuerAlt || t.issuerExt || t.issuerInt || '').trim();
  const account = (t.labelAlt || t.label || '').trim();
  const params: OtpParams = {
    type: String(t.type ?? 'TOTP').toUpperCase() === 'HOTP' ? 'hotp' : 'totp',
    secret,
    algorithm: algo === 'SHA256' || algo === 'SHA512' ? algo : 'SHA1',
    digits: t.digits || 6,
    period: t.period || 30,
    counter: t.counter || 0,
    issuer: issuer || undefined,
    account: account || undefined
  };
  return { issuer, account, uri: buildOtpUri(params) };
}

/** Thrown when a file isn't in any format we can read. */
export class OtpImportFormatError extends Error {}

/** Parse a FreeOTP JSON backup or an otpauth:// list. Order follows the app's own order. */
export function parseOtpImport(text: string): ImportedToken[] {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let data: unknown;
    try {
      data = JSON.parse(trimmed);
    } catch {
      throw new OtpImportFormatError('The file is not valid JSON');
    }
    const tokens = Array.isArray(data) ? data : (data as { tokens?: unknown }).tokens;
    if (!Array.isArray(tokens)) throw new OtpImportFormatError('No tokens found in the file');
    // tokenOrder lists "issuer:label" keys in the order the user arranged them
    const order = (data as { tokenOrder?: unknown }).tokenOrder;
    const rank = new Map((Array.isArray(order) ? order : []).map((k, i) => [String(k), i]));
    const keyOf = (t: FreeOtpToken) => `${t.issuerInt || t.issuerExt || ''}:${t.label || ''}`;
    const out: { tok: ImportedToken; r: number }[] = [];
    tokens.forEach((raw, i) => {
      try {
        out.push({ tok: freeOtpToken(raw as FreeOtpToken), r: rank.get(keyOf(raw as FreeOtpToken)) ?? rank.size + i });
      } catch {
        /* a token without a usable secret is skipped */
      }
    });
    if (!out.length) throw new OtpImportFormatError('No one-time code setups found in the file');
    return out.sort((a, b) => a.r - b.r).map((x) => x.tok);
  }
  const uris = trimmed.split(/\s+/).filter((l) => /^otpauth:\/\//i.test(l));
  if (!uris.length) throw new OtpImportFormatError('No one-time code setups found in the file');
  return uris.flatMap((uri) => {
    try {
      const p = parseOtpUri(uri);
      return [{ issuer: p.issuer ?? '', account: p.account ?? '', uri }];
    } catch {
      return [];
    }
  });
}
