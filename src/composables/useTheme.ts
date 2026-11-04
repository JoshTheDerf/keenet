/** Applies the selected KeeWeb theme + font size to the document root and keeps
 * Nuxt UI's light/dark mode in sync. */
import { watchEffect } from 'vue';
import { usePreferredDark } from '@vueuse/core';
import { useSettingsStore, type ThemeName } from '@/stores/settings';

const DARK_THEMES = new Set<ThemeName>(['dark', 'sd', 'fb', 'db', 'te', 'dc']);

/** Light/dark twins, for following the system setting. */
const TWIN: Record<ThemeName, ThemeName> = {
  dark: 'light', light: 'dark', sd: 'sl', sl: 'sd', fb: 'bl', bl: 'fb',
  db: 'lb', lb: 'db', te: 'lt', lt: 'te', dc: 'hc', hc: 'dc'
};

const FONT_SIZE_PX: Record<0 | 1 | 2, string> = {
  0: '14px',
  1: '15px',
  2: '17px'
};

export function useTheme(): void {
  const settings = useSettingsStore();
  const systemDark = usePreferredDark();

  watchEffect(() => {
    const root = document.documentElement;
    // "Auto switch": the chosen theme's light or dark twin, as the system prefers
    let theme = settings.theme;
    if (settings.autoSwitchTheme && DARK_THEMES.has(theme) !== systemDark.value) theme = TWIN[theme];
    // Remove previous th-* classes.
    root.classList.forEach((c) => {
      if (c.startsWith('th-')) root.classList.remove(c);
    });
    root.classList.add(`th-${theme}`);

    const isDark = DARK_THEMES.has(theme);
    root.classList.toggle('dark', isDark);
    root.classList.toggle('light', !isDark);
    root.style.fontSize = FONT_SIZE_PX[settings.fontSize];
  });
}
