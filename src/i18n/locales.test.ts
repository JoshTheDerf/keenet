import { describe, expect, it } from 'vitest';
import de from '../locales/de-de.json';
import en from '../locales/en-us.json';
import fr from '../locales/fr-fr.json';

const enDict: Record<string, string> = en;

const locales: Record<string, Record<string, string>> = {
    'en-us': en,
    'de-de': de,
    'fr-fr': fr
};

describe('locale files', () => {
    const enKeys = Object.keys(en).sort();

    it.each(Object.keys(locales))('%s has the same key set as en-us', (name) => {
        const keys = Object.keys(locales[name]).sort();
        const missing = enKeys.filter((k) => !keys.includes(k));
        const extra = keys.filter((k) => !enKeys.includes(k));
        expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    });

    it.each(Object.keys(locales))('%s has no empty values', (name) => {
        const empty = Object.entries(locales[name])
            .filter(([, v]) => typeof v !== 'string' || v.trim() === '')
            .map(([k]) => k);
        expect(empty).toEqual([]);
    });

    it.each(Object.keys(locales))(
        '%s keeps the same interpolation placeholders as en-us',
        (name) => {
            const placeholders = (s: string) => (s.match(/\{\}/g) ?? []).length;
            const mismatched = Object.keys(locales[name])
                .filter((k) => k in enDict)
                .filter((k) => placeholders(enDict[k]) !== placeholders(locales[name][k]));
            expect(mismatched).toEqual([]);
        }
    );
});
