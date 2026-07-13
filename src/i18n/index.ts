/**
 * Minimal i18n layer. `base` (en-US) is always loaded; other locales are
 * lazy-loaded and merged over the base. Keys mirror the legacy KeeWeb locale
 * files so translations can be reused verbatim.
 */
import { reactive, computed } from 'vue';
import base from '@/locales/en-us.json';

type Dict = Record<string, string>;

export const AVAILABLE_LOCALES: Record<string, string> = {
  'en-us': 'English',
  'de-de': 'Deutsch',
  'fr-fr': 'Français'
};

const loaders: Record<string, () => Promise<{ default: Dict }>> = {
  'de-de': () => import('@/locales/de-de.json'),
  'fr-fr': () => import('@/locales/fr-fr.json')
};

const state = reactive<{ locale: string; dict: Dict }>({
  locale: 'en-us',
  dict: base as Dict
});

export async function setLocale(locale: string): Promise<void> {
  if (locale === 'en-us' || !loaders[locale]) {
    state.locale = 'en-us';
    state.dict = base as Dict;
    return;
  }
  const mod = await loaders[locale]();
  state.locale = locale;
  state.dict = { ...(base as Dict), ...mod.default };
}

/** Translate a key, with optional {}-style positional substitution. */
export function t(key: string, ...args: (string | number)[]): string {
  let value = state.dict[key] ?? (base as Dict)[key] ?? key;
  for (const arg of args) {
    value = value.replace('{}', String(arg));
  }
  return value;
}

export function useI18n() {
  return {
    t,
    locale: computed(() => state.locale),
    setLocale
  };
}

/** Detect a supported locale from the browser, defaulting to en-us. */
export function detectLocale(): string {
  const nav = (navigator.language || 'en-us').toLowerCase();
  if (AVAILABLE_LOCALES[nav]) return nav;
  const short = nav.split('-')[0];
  const match = Object.keys(AVAILABLE_LOCALES).find((l) => l.startsWith(short));
  return match ?? 'en-us';
}
