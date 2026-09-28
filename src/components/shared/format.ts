/** Small display helpers shared by several components. */
import { t } from '@/i18n';

/** Readable message from anything thrown. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Host part of a URL for compact display; tolerates scheme-less input. */
export function hostOf(url: string): string {
  if (!url) return '';
  for (const candidate of [url, `https://${url}`]) {
    try {
      return new URL(candidate).host;
    } catch {
      /* try the next form */
    }
  }
  return url;
}

/** Localized name of a named entry color (e.g. "red" → t('colorRed')). */
export function colorLabel(color: string): string {
  return t(`color${color[0].toUpperCase()}${color.slice(1)}`);
}
