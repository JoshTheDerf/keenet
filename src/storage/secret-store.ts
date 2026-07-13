/**
 * Pluggable secret storage for small credentials: OAuth token sets and the
 * WebDAV password. Nothing else in the app may persist secrets directly.
 *
 * Backends:
 *  - Web (default): localStorage under a `keeweb-secret:` prefix. The browser
 *    has no OS keychain, so this is the same trust level the app always had —
 *    the strict CSP and XSS hardening (DOMPurify, no eval/inline scripts) are
 *    the mitigation. The prefix exists so platform shells can find and migrate
 *    these values into a real keychain.
 *  - Desktop (Electron): `safeStorage` in the main process, registered by
 *    `src/desktop/register.ts`.
 *  - Mobile (Capacitor): Keystore/Keychain via capacitor-native-biometric,
 *    registered by `src/mobile/register.ts`.
 *
 * The `secretStore` facade keeps an in-memory cache so sync-ish call sites
 * (e.g. `isTokenValid`, the settings store's webdav ref) stay simple: main.ts
 * awaits `secretStore.preload()` before mounting, after which `getCached()`
 * returns the persisted values synchronously.
 */

export interface SecretBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Well-known secret keys
// ---------------------------------------------------------------------------

export const WEBDAV_PASSWORD_KEY = 'webdav-password';

export function oauthTokenKey(provider: string): string {
  return `oauth-token-${provider}`;
}

const OAUTH_PROVIDERS = ['dropbox', 'gdrive', 'onedrive'];

/** Every key the app stores — preloaded into the cache at startup. */
export const KNOWN_SECRET_KEYS: readonly string[] = [
  ...OAUTH_PROVIDERS.map(oauthTokenKey),
  WEBDAV_PASSWORD_KEY
];

// ---------------------------------------------------------------------------
// Default web backend
// ---------------------------------------------------------------------------

const WEB_PREFIX = 'keeweb-secret:';

/** localStorage is absent in non-DOM contexts (node-environment tests). */
function hasLocalStorage(): boolean {
  return typeof localStorage !== 'undefined';
}

const webBackend: SecretBackend = {
  get(key) {
    return Promise.resolve(hasLocalStorage() ? localStorage.getItem(WEB_PREFIX + key) : null);
  },
  set(key, value) {
    if (hasLocalStorage()) localStorage.setItem(WEB_PREFIX + key, value);
    return Promise.resolve();
  },
  remove(key) {
    if (hasLocalStorage()) localStorage.removeItem(WEB_PREFIX + key);
    return Promise.resolve();
  }
};

let backend: SecretBackend = webBackend;
const cache = new Map<string, string | null>();
let migration: Promise<void> | null = null;

/**
 * Install a platform backend (desktop/mobile shells). Clears the cache and
 * re-arms the legacy migration so plaintext (or web-fallback) values are moved
 * into the new backend on next access. Call before any store hydrates.
 */
export function registerSecretBackend(b: SecretBackend): void {
  backend = b;
  cache.clear();
  migration = null;
}

// ---------------------------------------------------------------------------
// One-time migration of legacy plaintext secrets
// ---------------------------------------------------------------------------

/** Legacy localStorage keys used before the secret store existed. */
const LEGACY_OAUTH_PREFIX = 'keeweb-oauth-';
const LEGACY_SETTINGS_KEY = 'keeweb-settings';

/** Write into the backend only when it doesn't already hold a value. */
async function moveIn(key: string, value: string): Promise<void> {
  if ((await backend.get(key)) === null) {
    await backend.set(key, value);
  }
}

/**
 * Migrate legacy plaintext values into the active backend, then delete the
 * plaintext originals:
 *  - OAuth token sets from their old `keeweb-oauth-<provider>` localStorage keys.
 *  - The WebDAV password from inside the `keeweb-settings` localStorage blob
 *    (the blob is rewritten without the password field).
 *  - When a platform (non-web) backend is active: any values a previous run
 *    stored via the web fallback (`keeweb-secret:*`).
 */
async function migrateLegacySecrets(): Promise<void> {
  try {
    for (const provider of OAUTH_PROVIDERS) {
      const legacy = localStorage.getItem(LEGACY_OAUTH_PREFIX + provider);
      if (legacy !== null) {
        await moveIn(oauthTokenKey(provider), legacy);
        localStorage.removeItem(LEGACY_OAUTH_PREFIX + provider);
      }
    }

    const rawSettings = localStorage.getItem(LEGACY_SETTINGS_KEY);
    if (rawSettings) {
      try {
        const parsed = JSON.parse(rawSettings) as { webdav?: { password?: unknown } };
        if (parsed.webdav && 'password' in parsed.webdav) {
          const pw = parsed.webdav.password;
          if (typeof pw === 'string' && pw) {
            await moveIn(WEBDAV_PASSWORD_KEY, pw);
          }
          delete parsed.webdav.password;
          localStorage.setItem(LEGACY_SETTINGS_KEY, JSON.stringify(parsed));
        }
      } catch {
        /* corrupt settings blob — leave it for the settings store to handle */
      }
    }

    if (backend !== webBackend) {
      const stranded: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(WEB_PREFIX)) stranded.push(k);
      }
      for (const k of stranded) {
        const value = localStorage.getItem(k);
        if (value !== null) {
          await moveIn(k.slice(WEB_PREFIX.length), value);
        }
        localStorage.removeItem(k);
      }
    }
  } catch {
    /* localStorage unavailable — nothing to migrate */
  }
}

function ensureMigrated(): Promise<void> {
  migration ??= migrateLegacySecrets();
  return migration;
}

// ---------------------------------------------------------------------------
// Facade
// ---------------------------------------------------------------------------

export const secretStore = {
  /** Read a secret (cache-through). Runs the legacy migration on first use. */
  async get(key: string): Promise<string | null> {
    await ensureMigrated();
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const value = await backend.get(key);
    cache.set(key, value);
    return value;
  },

  /**
   * Synchronous read from the in-memory cache. Returns null until the key was
   * loaded via {@link get}/{@link preload} (main.ts preloads before mount).
   */
  getCached(key: string): string | null {
    return cache.get(key) ?? null;
  },

  /** Store a secret. The cache is updated synchronously (before any await). */
  set(key: string, value: string): Promise<void> {
    cache.set(key, value);
    return (async () => {
      await ensureMigrated();
      await backend.set(key, value);
    })();
  },

  /** Delete a secret. The cache is updated synchronously (before any await). */
  remove(key: string): Promise<void> {
    cache.set(key, null);
    return (async () => {
      await ensureMigrated();
      await backend.remove(key);
    })();
  },

  /** Load keys into the cache (and run the migration). Awaited before mount. */
  async preload(keys: readonly string[] = KNOWN_SECRET_KEYS): Promise<void> {
    await Promise.all(keys.map((k) => this.get(k)));
  }
};

/** Test-only: restore the default web backend and clear all in-memory state. */
export function resetSecretStoreForTests(): void {
  backend = webBackend;
  cache.clear();
  migration = null;
}
