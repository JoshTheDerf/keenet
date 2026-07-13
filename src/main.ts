import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ui from '@nuxt/ui/vue-plugin';
import { addCollection } from '@iconify/vue';
import lucideBundle from '@/generated/lucide-bundle.json';
import App from '@/App.vue';
import { initKdbxweb } from '@/domain/kdbx-init';
import { setLocale, detectLocale } from '@/i18n';
import { useSettingsStore } from '@/stores/settings';
import { initOAuthCallback } from '@/storage';
import { secretStore } from '@/storage/secret-store';
import { configureDropbox } from '@/storage/dropbox';
import { configureGDrive } from '@/storage/gdrive';
import { configureOneDrive } from '@/storage/onedrive';
import { initDesktop } from '@/desktop/register';
import '@/assets/main.css';

async function bootstrap(): Promise<void> {
  // Under the Tauri desktop shell, install the `window.keeweb` bridge before
  // anything checks for it (initDesktop, the PWA guard below). The dynamic
  // import keeps @tauri-apps/* out of the browser bundle. No-op on web/mobile.
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const { installTauriBridge } = await import('@/desktop/tauri-bridge');
    await installTauriBridge();
  }

  // If this page load is an OAuth popup callback, post the code back and close.
  initOAuthCallback();

  // Wire the Argon2 KDF implementation into kdbxweb before anything opens a file.
  initKdbxweb();

  // Wire native desktop integrations (no-op in the browser build). Registers
  // the OS-keychain secret backend under the Tauri desktop shell.
  initDesktop();

  // Wire native mobile (Capacitor) integrations BEFORE hydrating stores: this
  // registers the Keystore/Keychain secret backend (no-op on web/desktop; the
  // dynamic import keeps the plugins out of the browser bundle).
  const mobile = await import('@/mobile/register');
  await mobile.initMobile();

  // Warm the secret cache (OAuth tokens, WebDAV password) from the platform
  // backend — and migrate any legacy plaintext values on first run — so sync
  // readers (isTokenValid, settings.webdav.password) are correct from mount.
  await secretStore.preload();

  // Register the bundled Lucide icons so <UIcon> resolves them locally instead of
  // fetching from the Iconify API at runtime — required behind strict CSPs and
  // offline (PWA / mobile / the Nextcloud embed). Regenerate with `npm run
  // gen:icons` after adding new icons.
  addCollection(lucideBundle);

  const app = createApp(App);
  const pinia = createPinia();

  app.use(pinia);
  app.use(ui);

  // Load the persisted locale (falling back to browser detection).
  const settings = useSettingsStore(pinia);
  void setLocale(settings.locale || detectLocale());

  // Apply any custom OAuth client ids (self-hosted origins need their own apps).
  if (settings.cloudKeys.dropboxAppKey) configureDropbox({ clientId: settings.cloudKeys.dropboxAppKey });
  if (settings.cloudKeys.gdriveClientId) configureGDrive({ clientId: settings.cloudKeys.gdriveClientId });
  if (settings.cloudKeys.onedriveClientId) configureOneDrive({ clientId: settings.cloudKeys.onedriveClientId });

  app.mount('#app');

  // Register the PWA service worker only in a real browser (not inside the
  // native webview or Tauri desktop shell), and not when embedded in another page (e.g.
  // the Nextcloud app iframe) — a SW there would needlessly cache the host's
  // subpath.
  const embedded = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();
  if (!mobile.isMobile() && !window.keeweb && !embedded) {
    void import('@/pwa').then((p) => p.initPwa());
  }
}

void bootstrap();
