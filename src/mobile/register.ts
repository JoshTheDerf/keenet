/**
 * Mobile (Capacitor) bootstrap. Safe to call unconditionally from main.ts:
 * a no-op on web/desktop, it wires native integrations only inside the
 * Capacitor webview shell. All plugins are dynamically imported so they stay
 * out of the browser bundle.
 */
import { Capacitor } from '@capacitor/core';
import { t } from '@/i18n';
import { setClipboardWriter } from '@/composables/useClipboard';
import { registerProvider } from '@/storage';
import { setOAuthAuthorizer, type OAuthAuthorizeResult } from '@/storage/oauth';
import { registerSecretBackend } from '@/storage/secret-store';
import { mobileFileProvider } from '@/mobile/mobile-file';

export function isMobile(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * OAuth redirect for the native app — a custom URL scheme caught as a deep link.
 * Register this exact value as an allowed redirect URI on each provider's OAuth
 * app, and declare the `keenet` scheme natively (Android intent-filter /
 * iOS CFBundleURLSchemes). Google installed-app clients may instead require
 * their reversed-client-id scheme.
 */
const MOBILE_REDIRECT_URI =
  import.meta.env.VITE_OAUTH_MOBILE_REDIRECT_URI ?? 'keenet://oauth2redirect';

// ---------------------------------------------------------------------------
// Secret storage — Android Keystore / iOS Keychain via capacitor-native-biometric.
//
// The plugin's getCredentials/setCredentials are plain keystore-encrypted
// reads/writes and do NOT trigger a biometric prompt (verified in the plugin
// sources: Android decrypts with a Keystore key created without
// setUserAuthenticationRequired; iOS reads a kSecClassInternetPassword item
// with no kSecAttrAccessControl). Biometric gating remains a separate,
// explicit verifyIdentity() call — see maybeBiometricUnlock() below.
//
// All secrets live in ONE credentials record holding a JSON map rather than
// one record per key, because the plugin's Android deleteCredentials() clears
// its ENTIRE SharedPreferences store (editor.clear()), so per-key records
// would delete each other; a single record also avoids one Keystore alias per
// secret.
// ---------------------------------------------------------------------------

const SECRETS_SERVER = 'keenet/secrets';

/** Serialize read-modify-write cycles so concurrent set/remove don't race. */
let secretsQueue: Promise<unknown> = Promise.resolve();
function enqueueSecretsOp<T>(op: () => Promise<T>): Promise<T> {
  const run = secretsQueue.then(op, op);
  secretsQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function readSecretsMap(): Promise<Record<string, string>> {
  const { NativeBiometric } = await import('capacitor-native-biometric');
  try {
    const creds = await NativeBiometric.getCredentials({ server: SECRETS_SERVER });
    const parsed = JSON.parse(creds.password) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    /* no record yet (plugin rejects with "No credentials found") */
  }
  return {};
}

async function writeSecretsMap(map: Record<string, string>): Promise<void> {
  const { NativeBiometric } = await import('capacitor-native-biometric');
  await NativeBiometric.setCredentials({
    server: SECRETS_SERVER,
    username: 'keenet',
    password: JSON.stringify(map)
  });
}

function registerMobileSecretBackend(): void {
  registerSecretBackend({
    get: (key) => enqueueSecretsOp(async () => (await readSecretsMap())[key] ?? null),
    set: (key, value) =>
      enqueueSecretsOp(async () => {
        const map = await readSecretsMap();
        map[key] = value;
        await writeSecretsMap(map);
      }),
    remove: (key) =>
      enqueueSecretsOp(async () => {
        const map = await readSecretsMap();
        if (key in map) {
          delete map[key];
          await writeSecretsMap(map);
        }
      })
  });
}

/** Open the system browser to the auth page and await the deep-link callback. */
async function mobileAuthorize(authUrl: string): Promise<OAuthAuthorizeResult> {
  const { Browser } = await import('@capacitor/browser');
  const { App } = await import('@capacitor/app');

  return new Promise<OAuthAuthorizeResult>((resolve, reject) => {
    let settled = false;
    let urlSub: { remove: () => void } | undefined;
    let finishSub: { remove: () => void } | undefined;
    const cleanup = (): void => {
      urlSub?.remove();
      finishSub?.remove();
    };

    void App.addListener('appUrlOpen', ({ url }) => {
      if (!url || !url.startsWith(MOBILE_REDIRECT_URI)) return;
      settled = true;
      cleanup();
      void Browser.close().catch(() => undefined);
      // Parse params from a custom-scheme URL (query and/or fragment).
      const params = new URLSearchParams(url.split(/[?#]/).slice(1).join('&'));
      const error = params.get('error');
      const code = params.get('code');
      const state = params.get('state');
      if (error) reject(new Error(`OAuth sign-in failed: ${error}`));
      // State is passed through — oauthFlow() validates it centrally.
      else if (code) resolve({ code, state: state ?? undefined });
      else reject(new Error('OAuth sign-in returned no authorization code.'));
    }).then((h) => {
      urlSub = h;
    });

    void Browser.addListener('browserFinished', () => {
      if (settled) return;
      cleanup();
      reject(new Error(t('authSignInCancelled')));
    }).then((h) => {
      finishSub = h;
    });

    void Browser.open({ url: authUrl }).catch((err) => {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}

export async function initMobile(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  // Keystore/Keychain-backed secret storage. Registered first: main.ts awaits
  // initMobile() and then preloads secrets before the stores hydrate.
  registerMobileSecretBackend();

  // Native local-file backend (reuses the `file` storage type).
  registerProvider(mobileFileProvider);

  // Native clipboard with the app's secure auto-clear.
  const { Clipboard } = await import('@capacitor/clipboard');
  setClipboardWriter({ write: (text) => Clipboard.write({ string: text }).then(() => undefined) });

  // OAuth: no same-origin popup in the webview — open the system browser and
  // catch the redirect back via a custom-scheme deep link.
  setOAuthAuthorizer({
    redirectUri: () => MOBILE_REDIRECT_URI,
    authorize: (authUrl) => mobileAuthorize(authUrl)
  });

  // Status bar styling.
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Dark });
  } catch {
    /* status bar not available on this platform */
  }

  // Android hardware back button: leave details → list, else send to background.
  const { App } = await import('@capacitor/app');
  App.addListener('backButton', ({ canGoBack }) => {
    const evt = new CustomEvent('kw:back');
    window.dispatchEvent(evt);
    if (!canGoBack) void App.minimizeApp?.();
  });

  // Biometric re-lock on resume.
  App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) void maybeBiometricUnlock();
  });
}

async function maybeBiometricUnlock(): Promise<void> {
  const { useSettingsStore } = await import('@/stores/settings');
  const { useVaultStore } = await import('@/stores/vault');
  const settings = useSettingsStore();
  const vault = useVaultStore();
  if (!settings.biometricLock || !vault.hasFiles) return;
  try {
    const { NativeBiometric } = await import('capacitor-native-biometric');
    const available = await NativeBiometric.isAvailable();
    if (!available.isAvailable) return;
    await NativeBiometric.verifyIdentity({
      reason: t('mobileBiometricReason'),
      title: 'KeeNet',
      subtitle: t('mobileBiometricSubtitle')
    });
  } catch {
    // Verification failed/cancelled → lock the vault.
    window.dispatchEvent(new CustomEvent('kw:lock'));
  }
}
