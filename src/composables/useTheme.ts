/** Applies the selected KeeWeb theme + font size to the document root and keeps
 * Nuxt UI's light/dark mode in sync. */
import { watchEffect } from 'vue';
import { useSettingsStore, type ThemeName } from '@/stores/settings';

const DARK_THEMES = new Set<ThemeName>(['dark', 'sd', 'fb', 'db', 'te', 'dc']);

const FONT_SIZE_PX: Record<0 | 1 | 2, string> = {
  0: '14px',
  1: '15px',
  2: '17px'
};

export function useTheme(): void {
  const settings = useSettingsStore();

  watchEffect(() => {
    const root = document.documentElement;
    // Remove previous th-* classes.
    root.classList.forEach((c) => {
      if (c.startsWith('th-')) root.classList.remove(c);
    });
    root.classList.add(`th-${settings.theme}`);

    const isDark = DARK_THEMES.has(settings.theme);
    root.classList.toggle('dark', isDark);
    root.classList.toggle('light', !isDark);
    root.style.fontSize = FONT_SIZE_PX[settings.fontSize];
  });
}
