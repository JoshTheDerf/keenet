import { describe, it, expect } from 'vitest';
import {
  generatePassword,
  buildCharPool,
  presetPoolSize,
  estimateEntropyBits,
  BUILTIN_PRESETS,
  CHAR_RANGES,
  type GeneratorPreset
} from './generator';

const base: GeneratorPreset = {
  name: 'Test',
  title: 'Test',
  length: 20,
  upper: true,
  lower: true,
  digits: true,
  special: false,
  brackets: false,
  high: false,
  ambiguous: false
};

describe('buildCharPool', () => {
  it('includes selected ranges and excludes ambiguous by default', () => {
    const pool = buildCharPool(base);
    expect(pool).toContain('A');
    expect(pool).toContain('a');
    expect(pool).toContain('5');
    // ambiguous chars removed
    expect(pool).not.toContain('O');
    expect(pool).not.toContain('0');
    expect(pool).not.toContain('l');
  });

  it('keeps ambiguous when enabled', () => {
    const pool = buildCharPool({ ...base, ambiguous: true });
    expect(pool).toContain('0');
    expect(pool).toContain('O');
  });

  it('honors an explicit include set', () => {
    expect(buildCharPool({ ...base, include: 'abc' })).toBe('abc');
  });

  it('returns empty when no ranges selected', () => {
    expect(
      buildCharPool({ ...base, upper: false, lower: false, digits: false })
    ).toBe('');
  });
});

describe('generatePassword', () => {
  it('produces the requested length', () => {
    for (let i = 0; i < 20; i++) {
      expect(generatePassword(base)).toHaveLength(20);
    }
  });

  it('only uses characters from the pool', () => {
    const pool = new Set(buildCharPool(base).split(''));
    const pw = generatePassword({ ...base, length: 200 });
    for (const ch of pw) expect(pool.has(ch)).toBe(true);
  });

  it('generates a PIN of only digits', () => {
    const pin = BUILTIN_PRESETS.find((p) => p.name === 'Pin4')!;
    const value = generatePassword(pin);
    expect(value).toMatch(/^\d{4}$/);
  });

  it('generates a MAC address pattern', () => {
    const mac = BUILTIN_PRESETS.find((p) => p.name === 'Mac')!;
    expect(generatePassword(mac)).toMatch(/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/);
  });

  it('generates hex keys of the right length', () => {
    const hash = BUILTIN_PRESETS.find((p) => p.name === 'Hash256')!;
    expect(generatePassword(hash)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces distinct values across calls (entropy sanity)', () => {
    const values = new Set(Array.from({ length: 50 }, () => generatePassword(base)));
    expect(values.size).toBeGreaterThan(45);
  });
});

describe('entropy', () => {
  it('estimateEntropyBits scales with length and pool', () => {
    expect(estimateEntropyBits(0, 26)).toBe(0);
    expect(estimateEntropyBits(10, 1)).toBe(0);
    expect(estimateEntropyBits(16, 64)).toBe(96); // 16 * 6
  });

  it('presetPoolSize matches CHAR_RANGES additions', () => {
    const digitsOnly: GeneratorPreset = { ...base, upper: false, lower: false, ambiguous: true };
    expect(presetPoolSize(digitsOnly)).toBe(CHAR_RANGES.digits.length);
  });
});
