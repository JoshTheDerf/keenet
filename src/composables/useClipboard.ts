/** Clipboard copy with auto-clear after the configured timeout. The writer is
 * pluggable so the native shells (Tauri / Capacitor) can supply a
 * platform-appropriate implementation. */
import { useSettingsStore } from '@/stores/settings';
import { useUiStore } from '@/stores/ui';
import { lockNow } from '@/composables/useLock';
import { t } from '@/i18n';

let clearTimer: ReturnType<typeof setTimeout> | null = null;

export interface CopyOptions {
  /** The value is a password / protected field — honors the lock-on-copy setting. */
  sensitive?: boolean;
}

export interface ClipboardWriter {
  write(text: string): Promise<void>;
}

const defaultWriter: ClipboardWriter = {
  write: (text) => navigator.clipboard.writeText(text)
};

let writer: ClipboardWriter = defaultWriter;

/** Native shells register their own clipboard (with secure auto-clear). */
export function setClipboardWriter(w: ClipboardWriter): void {
  writer = w;
}

export function useClipboard() {
  const settings = useSettingsStore();
  const ui = useUiStore();

  async function copy(text: string, label?: string, opts: CopyOptions = {}): Promise<void> {
    try {
      await writer.write(text);
      const lockAfterCopy = opts.sensitive === true && settings.lockOnCopy;
      ui.notify(t('clipCopied', label ?? t('clipValue')), {
        color: 'success',
        description:
          settings.clipboardSeconds > 0 ? t('clipClearsIn', settings.clipboardSeconds) : undefined
      });
      if (clearTimer) clearTimeout(clearTimer);
      // The clear timer lives at module level, so it keeps working after a
      // lock-on-copy lock (the clipboard still holds the secret until then).
      if (settings.clipboardSeconds > 0) {
        clearTimer = setTimeout(() => {
          writer.write('').catch(() => undefined);
        }, settings.clipboardSeconds * 1000);
      }
      if (lockAfterCopy) void lockNow();
    } catch {
      ui.notify(t('clipCopyFailed'), { color: 'error' });
    }
  }

  return { copy };
}
