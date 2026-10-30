import { defineStore } from 'pinia';
import { ref } from 'vue';

export type Screen = 'open' | 'app' | 'settings';

export interface Toast {
  id: number;
  title: string;
  description?: string;
  color?: 'success' | 'error' | 'warning' | 'info';
  /** A single button on the toast (e.g. Undo). Clicking it also dismisses the toast. */
  action?: { label: string; onClick: () => void };
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

  /** Whether the focused search box selects its text (Ctrl+F) or keeps typing (type-to-search). */
  const focusSearchSelect = ref(true);

  function requestFocusSearch(select = true): void {
    focusSearchSelect.value = select;
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
    // the same message again (copying twice) replaces the old one, and only the
    // newest few stay on screen so they never cover the list
    toasts.value = [...toasts.value.filter((x) => x.title !== title), toast].slice(-3);
    // Give the user a bit longer when there's something to click.
    setTimeout(() => dismiss(toast.id), toast.action ? 8000 : 4000);
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
    focusSearchSelect,
    requestFocusSearch,
    showScreen,
    openSettings,
    notify,
    dismiss
  };
});
