/**
 * Global keyboard shortcuts (KeeWeb-style). Meta/Ctrl combos work anywhere;
 * plain keys are ignored while typing in an input/textarea.
 */
import { onMounted, onUnmounted } from 'vue';
import { useVaultStore } from '@/stores/vault';
import { useUiStore } from '@/stores/ui';
import { useClipboard } from '@/composables/useClipboard';
import { lockNow } from '@/composables/useLock';
import { toggleCommandPalette } from '@/composables/useOverlays';
import { t } from '@/i18n';

function inEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

export function useKeyboardShortcuts(): void {
  const vault = useVaultStore();
  const ui = useUiStore();
  const { copy } = useClipboard();

  function handler(e: KeyboardEvent): void {
    if (ui.screen !== 'app') return;
    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      toggleCommandPalette();
      return;
    }
    if (mod && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      ui.requestFocusSearch();
      return;
    }
    if (mod && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      vault.createEntry();
      return;
    }
    if (mod && e.key.toLowerCase() === 'g') {
      e.preventDefault();
      vault.generatorOpen = true;
      return;
    }
    if (mod && e.key.toLowerCase() === 's') {
      // Save all modified files (same syncFile path as the titlebar button).
      e.preventDefault();
      for (const f of vault.files.filter((file) => file.modified)) {
        void vault.syncFile(f.id);
      }
      return;
    }
    if (mod && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      if (vault.hasFiles) void lockNow();
      return;
    }
    if (mod && e.key === ',') {
      e.preventDefault();
      ui.openSettings();
      return;
    }
    const entry = vault.selectedEntry;
    if (mod && e.key.toLowerCase() === 'b' && entry) {
      e.preventDefault();
      void copy(vault.resolveReference(entry.fileId, entry.username), t('user'));
      return;
    }
    if (mod && e.key.toLowerCase() === 'c' && entry && !inEditable(e.target) && !window.getSelection()?.toString()) {
      e.preventDefault();
      void copy(vault.resolveReference(entry.fileId, entry.password), t('password'), { sensitive: true });
      return;
    }
    if (e.key === 'Escape' && !inEditable(e.target)) {
      if (vault.selectedEntryId) vault.selectEntry(null);
    }
  }

  onMounted(() => window.addEventListener('keydown', handler));
  onUnmounted(() => window.removeEventListener('keydown', handler));
}
