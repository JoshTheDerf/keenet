/**
 * QR codes → one-time code setups. Decoding uses the browser's BarcodeDetector
 * where it exists (Chromium on Android/macOS) and falls back to jsQR, loaded
 * on first use, everywhere else. Understands plain otpauth:// codes and Google
 * Authenticator's otpauth-migration:// export codes.
 */
import { base32Encode, buildOtpUri, parseOtpUri, type OtpParams } from '@/domain/otp';
import type { ImportedToken } from '@/domain/otp-import';

// Minimal typing for the BarcodeDetector API (not in lib.dom).
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?(): Promise<string[]>;
}

type Source = HTMLVideoElement | HTMLImageElement | ImageBitmap | HTMLCanvasElement;
export type QrReader = (source: Source) => Promise<string[]>;

async function nativeDetector(): Promise<BarcodeDetectorLike | null> {
  const Ctor = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    const formats = (await Ctor.getSupportedFormats?.()) ?? ['qr_code'];
    return formats.includes('qr_code') ? new Ctor({ formats: ['qr_code'] }) : null;
  } catch {
    return null;
  }
}

function sizeOf(source: Source): [number, number] {
  if (source instanceof HTMLVideoElement) return [source.videoWidth, source.videoHeight];
  if (source instanceof HTMLImageElement) return [source.naturalWidth, source.naturalHeight];
  return [source.width, source.height];
}

/** A reader that decodes QR codes from video frames or images. */
export async function createQrReader(): Promise<QrReader> {
  const native = await nativeDetector();
  if (native) {
    return async (source) => (await native.detect(source)).map((r) => r.rawValue);
  }
  const { default: jsQR } = await import('jsqr');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return async (source) => {
    let [w, h] = sizeOf(source);
    if (!w || !h || !ctx) return [];
    // big photos decode slowly and no better; QR codes stay readable at ~1000px
    const scale = Math.min(1, 1000 / Math.max(w, h));
    w = Math.round(w * scale);
    h = Math.round(h * scale);
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(source, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const hit = jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' });
    return hit?.data ? [hit.data] : [];
  };
}

/** Decode a QR code in an image file or pasted image. */
export async function readQrFromBlob(blob: Blob): Promise<string[]> {
  const bitmap = await createImageBitmap(blob);
  try {
    return await (await createQrReader())(bitmap);
  } finally {
    bitmap.close();
  }
}

// ---- otpauth-migration:// (Google Authenticator "Transfer accounts") --------

/** Read protobuf fields: [fieldNumber, value] with varints as numbers and length-delimited as bytes. */
function* protoFields(buf: Uint8Array): Generator<[number, number | Uint8Array]> {
  let i = 0;
  const varint = (): number => {
    let result = 0;
    let mul = 1;
    for (;;) {
      if (i >= buf.length) throw new Error('Truncated data');
      const b = buf[i++];
      result += (b & 0x7f) * mul;
      if (!(b & 0x80)) return result;
      mul *= 128;
    }
  };
  while (i < buf.length) {
    const key = varint();
    const field = Math.floor(key / 8);
    switch (key & 7) {
      case 0:
        yield [field, varint()];
        break;
      case 2: {
        const len = varint();
        if (i + len > buf.length) throw new Error('Truncated data');
        yield [field, buf.subarray(i, i + len)];
        i += len;
        break;
      }
      case 1:
        i += 8;
        break;
      case 5:
        i += 4;
        break;
      default:
        throw new Error('Unsupported data');
    }
  }
}

function migrationTokens(uri: string): ImportedToken[] {
  const data = new URL(uri).searchParams.get('data');
  if (!data) return [];
  const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const dec = new TextDecoder();
  const out: ImportedToken[] = [];
  for (const [field, value] of protoFields(bytes)) {
    if (field !== 1 || !(value instanceof Uint8Array)) continue;
    const p: OtpParams = { type: 'totp', secret: '', algorithm: 'SHA1', digits: 6, period: 30, counter: 0 };
    let name = '';
    let issuer = '';
    for (const [f, v] of protoFields(value)) {
      if (f === 1 && v instanceof Uint8Array) p.secret = base32Encode(v);
      else if (f === 2 && v instanceof Uint8Array) name = dec.decode(v);
      else if (f === 3 && v instanceof Uint8Array) issuer = dec.decode(v);
      else if (f === 4 && typeof v === 'number') p.algorithm = v === 2 ? 'SHA256' : v === 3 ? 'SHA512' : 'SHA1';
      else if (f === 5 && typeof v === 'number') p.digits = v === 2 ? 8 : 6;
      else if (f === 6 && typeof v === 'number') p.type = v === 1 ? 'hotp' : 'totp';
      else if (f === 7 && typeof v === 'number') p.counter = v;
    }
    if (!p.secret) continue;
    // the name is often "Issuer:account"
    const colon = name.indexOf(':');
    if (colon !== -1) {
      issuer ||= name.slice(0, colon).trim();
      name = name.slice(colon + 1).trim();
    }
    p.issuer = issuer || undefined;
    p.account = name || undefined;
    out.push({ issuer, account: name, uri: buildOtpUri(p) });
  }
  return out;
}

/** The one-time code setups a scanned QR code carries (none when it isn't an OTP code). */
export function otpTokensFromQr(text: string): ImportedToken[] {
  const value = text.trim();
  try {
    if (/^otpauth-migration:\/\//i.test(value)) return migrationTokens(value);
    if (/^otpauth:\/\//i.test(value)) {
      const p = parseOtpUri(value);
      return [{ issuer: p.issuer ?? '', account: p.account ?? '', uri: value }];
    }
  } catch {
    /* fall through: not a usable code */
  }
  return [];
}
