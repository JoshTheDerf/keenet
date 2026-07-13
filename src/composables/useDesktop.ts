/** Access to the desktop bridge (`window.keeweb`), if present. */
import type { KeeWebDesktopApi } from '@/types/desktop';

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && !!window.keeweb;
}

export function desktop(): KeeWebDesktopApi | undefined {
  return typeof window !== 'undefined' ? window.keeweb : undefined;
}
