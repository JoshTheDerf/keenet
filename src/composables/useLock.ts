/**
 * Locking + idle handling. "Lock" persists any modified files that have a
 * destination, then closes all open databases and returns to the open screen
 * (the decrypted data is dropped from memory). Triggers: idle timeout, tab
 * hidden (lock-on-minimize), and the desktop OS-lock/suspend event.
 */
import { watch, onMounted, onUnmounted, effectScope, type EffectScope } from 'vue';
import { useIdle } from '@vueuse/core';
import { useVaultStore } from '@/stores/vault';
import { useSettingsStore } from '@/stores/settings';
import { useUiStore } from '@/stores/ui';
import { getProvider } from '@/storage';
import { desktop, isDesktop } from '@/composables/useDesktop';
import { t } from '@/i18n';

/**
 * Lock immediately: best-effort persist of modified files that have a
 * destination, then close everything and return to the open screen. This is
 * the single shared lock path — every lock trigger (titlebar button, keyboard
 * shortcut, idle timeout, lock-on-copy, OS lock) must go through it so unsaved
 * changes are not silently discarded.
 */
export async function lockNow(): Promise<void> {
  const vault = useVaultStore();
  const ui = useUiStore();
  if (!vault.hasFiles) return;
  for (const file of vault.rawFiles()) {
    const hasDest = file.fsHandle || (getProvider(file.storage) && file.path);
    if (file.modified && hasDest) {
      await vault.persistFile(file.id).catch(() => undefined);
    }
  }
  for (const f of [...vault.files]) vault.closeFile(f.id);
  ui.showScreen('open');
  ui.notify(t('appLocked'), { color: 'info' });
}

export function useLock(): void {
  const vault = useVaultStore();
  const settings = useSettingsStore();

  const lock = lockNow;

  // Idle timeout. `useIdle` takes a plain (non-reactive) timeout, so the idle
  // tracker lives in its own effect scope and is torn down and recreated
  // whenever the setting changes — no reload needed to apply a new threshold.
  let idleScope: EffectScope | undefined;
  function setupIdleTracking(minutes: number): void {
    idleScope?.stop();
    idleScope = effectScope();
    idleScope.run(() => {
      const idleMs = Math.max(0, minutes) * 60_000;
      const { idle } = useIdle(idleMs || 24 * 60 * 60 * 1000);
      watch(idle, (isIdle) => {
        if (isIdle && settings.idleMinutes > 0 && vault.hasFiles) void lock();
      });
    });
  }
  watch(() => settings.idleMinutes, setupIdleTracking, { immediate: true });

  // Lock on tab hidden.
  function onVisibility(): void {
    if (document.hidden && settings.lockOnMinimize && vault.hasFiles) void lock();
  }

  // Desktop OS-lock / suspend.
  // Any shell (mobile biometric fail, menu action) can request a lock.
  const onGlobalLock = (): void => void lock();

  let unsub: (() => void) | undefined;
  onMounted(() => {
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('kw:lock', onGlobalLock);
    if (isDesktop()) unsub = desktop()?.on('lock', () => void lock());
  });
  onUnmounted(() => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('kw:lock', onGlobalLock);
    unsub?.();
    idleScope?.stop();
  });
}
