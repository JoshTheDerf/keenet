/** KeePass entry color palette. fg = foreground marker, bg = row background. */
import type { NamedColor } from '@/types';

export const ALL_COLORS: NamedColor[] = ['yellow', 'green', 'red', 'orange', 'blue', 'violet'];

export const COLOR_FG: Record<NamedColor, string> = {
  yellow: 'ffff00',
  green: '00ff00',
  red: 'ff0000',
  orange: 'ff8800',
  blue: '0000ff',
  violet: 'ff00ff'
};

export const COLOR_BG: Record<NamedColor, string> = {
  yellow: 'ffff88',
  green: '88ff88',
  red: 'ff8888',
  orange: 'ffcc88',
  blue: '8888ff',
  violet: 'ff88ff'
};

/** CSS display color (used for swatches / dots in the UI). */
export const COLOR_DISPLAY: Record<NamedColor, string> = {
  yellow: '#f8e71c',
  green: '#7ed321',
  red: '#f5524c',
  orange: '#f5a623',
  blue: '#4a90e2',
  violet: '#9013fe'
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16)
  ];
}

/** Map an arbitrary hex bg color (from KeePass) to the nearest named color. */
export function nearestNamedColor(hex: string | undefined): NamedColor | undefined {
  if (!hex) return undefined;
  const clean = hex.replace('#', '');
  if (clean.length < 6) return undefined;
  const [r, g, b] = hexToRgb(clean);
  let best: NamedColor | undefined;
  let bestDist = Infinity;
  for (const color of ALL_COLORS) {
    const [cr, cg, cb] = hexToRgb(COLOR_BG[color]);
    const dist = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = color;
    }
  }
  return best;
}
