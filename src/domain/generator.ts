/**
 * Password / passphrase generator.
 *
 * Port of KeeWeb's PasswordGenerator with the same character ranges and preset
 * semantics, rewritten as a pure, dependency-free, fully-typed module so it can
 * be unit-tested in isolation.
 */

export interface GeneratorRanges {
  upper: boolean;
  lower: boolean;
  digits: boolean;
  special: boolean;
  brackets: boolean;
  high: boolean;
  ambiguous: boolean;
}

export interface GeneratorPreset extends GeneratorRanges {
  name: string;
  title: string;
  length: number;
  /** Optional fixed character pool that overrides the range flags. */
  include?: string;
  /** A curated pattern string, e.g. "Aaa0-9". Optional. */
  pattern?: string;
  builtin?: boolean;
  default?: boolean;
  disabled?: boolean;
}

export const CHAR_RANGES: Record<keyof GeneratorRanges, string> = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
  special: '!@#$%^&*_+-=,./?;:`~',
  brackets: '(){}[]<>',
  high: '¡¢£¤¥¦§©ª«¬®°±¹²³µ¶¼½¾ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþ',
  ambiguous: 'O0oIlL1|'
};

export const BUILTIN_PRESETS: GeneratorPreset[] = [
  {
    name: 'Default',
    title: 'Default',
    length: 16,
    upper: true,
    lower: true,
    digits: true,
    special: false,
    brackets: false,
    high: false,
    ambiguous: false,
    builtin: true,
    default: true
  },
  {
    name: 'Pronounceable',
    title: 'Pronounceable',
    length: 10,
    upper: true,
    lower: true,
    digits: false,
    special: false,
    brackets: false,
    high: false,
    ambiguous: false,
    builtin: true
  },
  {
    name: 'Med',
    title: 'Medium',
    length: 12,
    upper: true,
    lower: true,
    digits: true,
    special: false,
    brackets: false,
    high: false,
    ambiguous: false,
    builtin: true
  },
  {
    name: 'Long',
    title: 'Long',
    length: 32,
    upper: true,
    lower: true,
    digits: true,
    special: false,
    brackets: false,
    high: false,
    ambiguous: false,
    builtin: true
  },
  {
    name: 'Pin4',
    title: 'PIN (4 digits)',
    length: 4,
    upper: false,
    lower: false,
    digits: true,
    special: false,
    brackets: false,
    high: false,
    ambiguous: false,
    builtin: true
  },
  {
    name: 'Mac',
    title: 'MAC address',
    length: 17,
    upper: false,
    lower: false,
    digits: false,
    special: false,
    brackets: false,
    high: false,
    ambiguous: false,
    include: '0123456789ABCDEF',
    pattern: 'mac',
    builtin: true
  },
  {
    name: 'Hash128',
    title: 'Hex key (128-bit)',
    length: 32,
    upper: false,
    lower: false,
    digits: false,
    special: false,
    brackets: false,
    high: false,
    ambiguous: false,
    include: '0123456789abcdef',
    builtin: true
  },
  {
    name: 'Hash256',
    title: 'Hex key (256-bit)',
    length: 64,
    upper: false,
    lower: false,
    digits: false,
    special: false,
    brackets: false,
    high: false,
    ambiguous: false,
    include: '0123456789abcdef',
    builtin: true
  }
];

/**
 * Preset used for one-click generation (e.g. the dice button on a password
 * field): the user's default preset if one is marked, else the first builtin.
 */
export function resolveDefaultPreset(userPresets: GeneratorPreset[] = []): GeneratorPreset {
  return userPresets.find((p) => p.default && !p.disabled) ?? BUILTIN_PRESETS[0];
}

/** Cryptographically secure random integer in [0, max). */
function secureRandomInt(max: number): number {
  if (max <= 0) return 0;
  // Rejection sampling to avoid modulo bias.
  const limit = Math.floor(0xffffffff / max) * max;
  const arr = new Uint32Array(1);
  let val: number;
  do {
    crypto.getRandomValues(arr);
    val = arr[0];
  } while (val >= limit);
  return val % max;
}

function pick(chars: string): string {
  return chars.charAt(secureRandomInt(chars.length));
}

/** Build the character pool implied by a preset's range flags / include string. */
export function buildCharPool(preset: GeneratorRanges & { include?: string }): string {
  if (preset.include) return preset.include;
  let pool = '';
  (Object.keys(CHAR_RANGES) as (keyof GeneratorRanges)[]).forEach((range) => {
    if (range === 'ambiguous') return; // handled as exclusion below
    if (preset[range]) pool += CHAR_RANGES[range];
  });
  if (!preset.ambiguous) {
    const ambiguous = new Set(CHAR_RANGES.ambiguous.split(''));
    pool = pool
      .split('')
      .filter((c) => !ambiguous.has(c))
      .join('');
  }
  return pool;
}

const CONSONANTS = 'bcdfghjklmnpqrstvwxz';
const VOWELS = 'aeiou';

/** Generate an easy-to-pronounce password by alternating consonant/vowel pairs. */
function generatePronounceable(length: number, upper: boolean): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    let ch = i % 2 === 0 ? pick(CONSONANTS) : pick(VOWELS);
    if (upper && secureRandomInt(4) === 0) ch = ch.toUpperCase();
    result += ch;
  }
  return result;
}

/** Generate a MAC-address-style value: 6 hex octets separated by colons. */
function generateMac(): string {
  const hex = '0123456789ABCDEF';
  const octets: string[] = [];
  for (let i = 0; i < 6; i++) {
    octets.push(pick(hex) + pick(hex));
  }
  return octets.join(':');
}

export function generatePassword(preset: GeneratorPreset): string {
  if (preset.pattern === 'mac') return generateMac();
  if (preset.name === 'Pronounceable') return generatePronounceable(preset.length, preset.upper);

  const pool = buildCharPool(preset);
  if (!pool.length) return '';

  let result = '';
  for (let i = 0; i < preset.length; i++) {
    result += pick(pool);
  }
  return result;
}

/**
 * Estimate entropy in bits for a password produced from the given pool size.
 * bits = length * log2(poolSize)
 */
export function estimateEntropyBits(length: number, poolSize: number): number {
  if (poolSize <= 1 || length <= 0) return 0;
  return Math.round(length * Math.log2(poolSize));
}

export function presetPoolSize(preset: GeneratorPreset): number {
  if (preset.pattern === 'mac') return 16;
  return buildCharPool(preset).length;
}
