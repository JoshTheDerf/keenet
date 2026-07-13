/**
 * PWA service-worker registration.
 *
 * The browser only checks for a new service worker on navigation and roughly
 * once a day, so a long-lived SPA tab (a password manager is often left open)
 * would never pick up a fresh deploy. We therefore poll `registration.update()`
 * on an interval and whenever the tab regains focus/visibility.
 *
 * We run in 'prompt' mode (see vite.config) so a waiting SW does NOT activate
 * on its own — activating swaps the controller and reloads the page, which
 * would drop an unlocked, mid-edit session. Instead we apply the update only
 * when it's safe: no open file has unsaved changes. Otherwise we defer and
 * re-check on the next tick / visibility change.
 */
import { registerSW } from 'virtual:pwa-register';
import { t } from '@/i18n';
import { useUiStore } from '@/stores/ui';
import { useVaultStore } from '@/stores/vault';

/** How often to ask the browser to re-check for a new service worker. */
const UPDATE_POLL_MS = 60 * 60 * 1000; // hourly

export function initPwa(): void {
  // Skip in the native mobile/desktop shells (they load bundled assets).
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  let refreshPending = false;
  let notified = false;

  const applyIfSafe = (): void => {
    if (!refreshPending) return;
    // Don't clobber unsaved work — a reload would lose it and re-lock the vault.
    if (useVaultStore().files.some((f) => f.modified)) {
      if (!notified) {
        notified = true;
        useUiStore().notify(t('appUpdateReady'), {
          description: t('appUpdateReadyBody'),
          color: 'info'
        });
      }
      return;
    }
    void updateSW(true); // SKIP_WAITING → controllerchange → reload
  };

  const updateSW = registerSW({
    immediate: true,

    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // Poll for a newer SW in the background…
      setInterval(() => void registration.update(), UPDATE_POLL_MS);
      // …and whenever the user comes back to the tab (catches new deploys fast,
      // and retries a deferred apply once the vault is clean).
      const recheck = (): void => {
        if (document.visibilityState === 'visible') {
          void registration.update();
          applyIfSafe();
        }
      };
      document.addEventListener('visibilitychange', recheck);
      window.addEventListener('focus', recheck);
    },

    onNeedRefresh() {
      refreshPending = true;
      applyIfSafe();
    },

    onOfflineReady() {
      useUiStore().notify(t('appOfflineReady'), { color: 'success' });
    }
  });

  // Re-attempt a deferred update when the vault returns to a clean state
  // (e.g. after the user saves or locks). Cheap: only acts while pending.
  window.addEventListener('kw:lock', applyIfSafe);
}
