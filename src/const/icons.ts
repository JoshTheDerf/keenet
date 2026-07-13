/**
 * KeePass built-in icon indices (0–68) mapped to Lucide icon names used by
 * Nuxt UI (`i-lucide-<name>`). Mirrors the ordering of the KeePass icon set so
 * icons chosen in other KeePass clients render correctly here.
 */
export const KEEPASS_ICON_TO_LUCIDE: string[] = [
  'key', // 0
  'globe',
  'triangle-alert',
  'server',
  'pin',
  'messages-square',
  'puzzle',
  'pencil',
  'plug',
  'contact',
  'paperclip', // 10
  'camera',
  'wifi',
  'link',
  'battery-medium',
  'barcode',
  'award',
  'target',
  'monitor',
  'mail',
  'settings', // 20
  'clipboard',
  'send',
  'newspaper',
  'zap',
  'inbox',
  'save',
  'hard-drive',
  'circle-dot',
  'lock-keyhole',
  'terminal', // 30
  'printer',
  'network',
  'flag',
  'wrench',
  'laptop',
  'archive',
  'credit-card',
  'app-window',
  'clock',
  'search', // 40
  'flask-conical',
  'gamepad-2',
  'trash',
  'sticky-note',
  'ban',
  'circle-help',
  'box',
  'folder',
  'folder-open',
  'database', // 50
  'lock-open',
  'lock',
  'check',
  'pencil',
  'image',
  'book',
  'list',
  'venetian-mask',
  'utensils',
  'house', // 60
  'star',
  'monitor',
  'map-pin',
  'command',
  'book-open',
  'dollar-sign',
  'signature',
  'smartphone' // 68
];

export const DEFAULT_ENTRY_ICON = 0;
export const DEFAULT_GROUP_ICON = 48;

export function iconName(index: number | undefined): string {
  if (index === undefined || index < 0 || index >= KEEPASS_ICON_TO_LUCIDE.length) {
    return KEEPASS_ICON_TO_LUCIDE[DEFAULT_ENTRY_ICON];
  }
  return KEEPASS_ICON_TO_LUCIDE[index];
}

/** `i-lucide-<name>` string for a KeePass icon index (for Nuxt UI :icon props). */
export function iconClass(index: number | undefined): string {
  return `i-lucide-${iconName(index)}`;
}
