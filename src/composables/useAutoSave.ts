/**
 * Auto-save / auto-sync engine.
 *
 * - When `autoSave` is on, changes are persisted after a short debounce, but
 *   only for files that have a real destination (a storage provider + path, or
 *   a File System Access handle). Download-only files are never auto-saved.
 * - When `autoSaveInterval` (minutes) > 0, remote files are synced on that
 *   cadence: pull + merge, then push only when there are local changes.
 */
import { watch, onUnmounted } from 'vue';
import { useVaultStore } from '@/stores/vault';
import { useSettingsStore } from '@/stores/settings';
import { getProvider } from '@/storage';
import type { KdbxFile } from '@/domain/kdbx-file';

const DEBOUNCE_MS = 2500;

/** Whether the file can be written back without a Save-As / download prompt. */
export function hasDestination(file: KdbxFile): boolean {
  return !!file.fsHandle || isRemote(file);
}

function isRemote(file: KdbxFile): boolean {
  return !!getProvider(file.storage) && !!file.path;
}

/**
 * Write a modified file to its destination. Remote files go through the
 * conflict-safe pull, merge, push path when "sync on save" is on; local files
 * (and opt-outs) just persist.
 */
export function saveToDestination(file: KdbxFile): Promise<boolean> {
  const vault = useVaultStore();
  return isRemote(file) && useSettingsStore().syncOnSave
    ? vault.syncFile(file.id)
    : vault.persistFile(file.id);
}

export function useAutoSave(): void {
  const vault = useVaultStore();
  const settings = useSettingsStore();

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Debounced auto-save on modification.
  watch(
    () => vault.files.map((f) => `${f.id}:${f.modified}`).join(','),
    () => {
      if (!settings.autoSave) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        for (const file of vault.rawFiles()) {
          if (file.modified && hasDestination(file)) void saveToDestination(file);
        }
      }, DEBOUNCE_MS);
    }
  );

  // Periodic sync for remote files.
  let intervalTimer: ReturnType<typeof setInterval> | null = null;
  function resetInterval(): void {
    if (intervalTimer) clearInterval(intervalTimer);
    intervalTimer = null;
    const minutes = settings.autoSaveInterval;
    if (minutes > 0) {
      intervalTimer = setInterval(() => {
        for (const file of vault.rawFiles()) {
          if (isRemote(file)) void vault.syncFile(file.id);
        }
      }, minutes * 60_000);
    }
  }
  watch(() => settings.autoSaveInterval, resetInterval, { immediate: true });

  onUnmounted(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (intervalTimer) clearInterval(intervalTimer);
  });
}
