import { defineStore } from 'pinia';
import { ref } from 'vue';

export type Screen = 'open' | 'app' | 'settings';

export interface Toast {
  id: number;
  title: string;
  description?: string;
  color?: 'success' | 'error' | 'warning' | 'info';
}

let toastSeq = 0;

/** Global UI/navigation state: which top-level screen is showing + toasts. */
export const useUiStore = defineStore('ui', () => {
  const screen = ref<Screen>('open');
  const settingsPage = ref<string>('general');
  const menuCollapsed = ref(false);
  const toasts = ref<Toast[]>([]);
  /** Incremented to ask the search box to focus (keyboard shortcut). */
  const focusSearchToken = ref(0);

  function requestFocusSearch(): void {
    focusSearchToken.value++;
  }

  function showScreen(s: Screen): void {
    screen.value = s;
  }

  function openSettings(page = 'general'): void {
    settingsPage.value = page;
    screen.value = 'settings';
  }

  function notify(title: string, opts: Partial<Omit<Toast, 'id' | 'title'>> = {}): void {
    const toast: Toast = { id: ++toastSeq, title, ...opts };
    toasts.value.push(toast);
    setTimeout(() => dismiss(toast.id), 4000);
  }

  function dismiss(id: number): void {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }

  return {
    screen,
    settingsPage,
    menuCollapsed,
    toasts,
    focusSearchToken,
    requestFocusSearch,
    showScreen,
    openSettings,
    notify,
    dismiss
  };
});
