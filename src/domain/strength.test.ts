import { describe, it, expect } from 'vitest';
import { quickStrength, estimateStrength } from './strength';

describe('quickStrength', () => {
  it('rates empty as very weak', () => {
    expect(quickStrength('').level).toBe(0);
  });
  it('rates short simple passwords low', () => {
    expect(quickStrength('abc').level).toBeLessThanOrEqual(1);
  });
  it('rates long mixed passwords higher', () => {
    const s = quickStrength('Xk9!vP2@mQ7#nR4$');
    expect(s.level).toBeGreaterThanOrEqual(3);
  });
  it('exposes a normalized value and color', () => {
    const s = quickStrength('password');
    expect(s.value).toBeGreaterThanOrEqual(0);
    expect(s.value).toBeLessThanOrEqual(1);
    expect(['error', 'warning', 'primary', 'success']).toContain(s.color);
  });
});

describe('estimateStrength (zxcvbn)', () => {
  it('flags a common password as weak', async () => {
    const s = await estimateStrength('password');
    expect(s.level).toBeLessThanOrEqual(1);
  });
  it('rates a random long password strong', async () => {
    const s = await estimateStrength('7#kQ!9vLp2@mZ4nR8wX');
    expect(s.level).toBeGreaterThanOrEqual(3);
  });
});
