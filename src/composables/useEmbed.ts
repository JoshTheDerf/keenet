/**
 * Embedded mode (`?embed=1`): KeeNet inside another app's frame (Cloud's app
 * view). The host already shows the app's name and a toolbar, so KeeNet drops
 * its wordmark and tinted canvas, and the menu folds away behind a toggle.
 * `?theme=light|dark` follows the host's light/dark choice; a same-origin host
 * keeps it current with `{ type: 'host:theme', mode }` messages.
 */
import { ref } from 'vue';
import { useLocalStorage } from '@vueuse/core';

const params = new URLSearchParams(location.search);

export const embedded = params.has('embed') && params.get('embed') !== '0';

type Mode = 'light' | 'dark';
const isMode = (v: unknown): v is Mode => v === 'light' || v === 'dark';
const initial = params.get('theme');
export const hostTheme = ref<Mode | null>(embedded && isMode(initial) ? initial : null);

if (embedded) {
  window.addEventListener('message', (e) => {
    // only our own origin's frame host (Cloud serves KeeNet from its origin)
    if (window.parent === window || e.origin !== location.origin || e.source !== window.parent) return;
    const d = e.data as { type?: string; mode?: unknown } | null;
    if (d?.type === 'host:theme' && isMode(d.mode)) hostTheme.value = d.mode;
  });
}

/** Embedded, wide screens: whether the menu column is shown (remembered). */
export const embedMenuOpen = useLocalStorage('kw-embed-menu', false);

if (embedded) document.documentElement.classList.add('kw-embedded');
