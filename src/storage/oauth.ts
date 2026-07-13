/**
 * Shared OAuth 2.0 (Authorization Code + PKCE) machinery for cloud storage
 * providers. Uses only `fetch` and Web Crypto — no external dependencies.
 *
 * The app is served at a single page (e.g. `/keeweb/`) which doubles as the
 * OAuth redirect URI. Sign-in opens that same page in a popup; after the
 * provider redirects back with `?code=...`, {@link initOAuthCallback} (run at
 * startup) detects the sentinel `state`, hands the code to the opener via
 * `postMessage`, and closes the popup.
 */

import { secretStore, oauthTokenKey } from './secret-store';

export type OAuthProviderId = 'dropbox' | 'gdrive' | 'onedrive';

/** A persisted token set for a provider. */
export interface StoredToken {
  access_token: string;
  refresh_token?: string;
  /** Absolute expiry, epoch milliseconds. */
  expiry: number;
}

/** Raw token endpoint response shape. */
interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

/** PKCE verifier/challenge pair. */
export interface PkcePair {
  verifier: string;
  challenge: string;
}

interface OAuthCallbackMessage {
  keeweb_oauth: true;
  code?: string;
  error?: string;
  state?: string;
}

const STATE_PREFIX = 'keeweb_oauth:';
const STATE_KEY = 'keeweb-oauth-pending-state';
const VERIFIER_KEY = 'keeweb-oauth-pending-verifier';
/** Refresh a little early to avoid using a token that expires mid-request. */
const EXPIRY_SKEW_MS = 60_000;

const OAUTH_PROVIDER_IDS: OAuthProviderId[] = ['dropbox', 'gdrive', 'onedrive'];

// ---------------------------------------------------------------------------
// base64url helpers
// ---------------------------------------------------------------------------

export function base64UrlEncode(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let str = '';
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

// ---------------------------------------------------------------------------
// PKCE
// ---------------------------------------------------------------------------

export async function generatePkce(): Promise<PkcePair> {
  const verifier = randomToken(32);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64UrlEncode(digest) };
}

// ---------------------------------------------------------------------------
// Pluggable authorizer (web popup / desktop / mobile)
// ---------------------------------------------------------------------------

/**
 * Obtaining the authorization code is platform-specific:
 *  - Web: open a popup at our own page and receive the code via `postMessage`.
 *  - Desktop (Electron): open a child window and intercept the redirect in the
 *    main process (see `src/desktop/register.ts`).
 *  - Mobile (Capacitor): open the system browser and catch the custom-scheme
 *    deep link (see `src/mobile/register.ts`).
 *
 * Each platform also defines the redirect URI it uses — it must exactly match a
 * URI registered on the provider's OAuth app and is sent in both the authorize
 * request and the token exchange.
 */
/** Authorization-code callback result. `state` MUST echo what we generated —
 * {@link oauthFlow} rejects the code on any mismatch (CSRF/code-injection guard). */
export interface OAuthAuthorizeResult {
  code: string;
  /** The `state` parameter as returned by the provider redirect. */
  state?: string;
}

export interface OAuthAuthorizer {
  /** Redirect URI to send in the flow (must be registered with the provider). */
  redirectUri(): string;
  /** Open the provider's auth page and resolve with the authorization code
   * and the returned `state` (validated centrally in {@link oauthFlow}). */
  authorize(authUrl: string, state: string): Promise<OAuthAuthorizeResult>;
}

/** Default web authorizer: same-origin popup + postMessage callback. */
const webAuthorizer: OAuthAuthorizer = {
  redirectUri: () => `${location.origin}${location.pathname}`,
  authorize: (authUrl, state) => openPopupAndAwaitCode(authUrl, state)
};

let activeAuthorizer: OAuthAuthorizer = webAuthorizer;

/** Install a platform authorizer (desktop/mobile). No-op keeps the web popup. */
export function setOAuthAuthorizer(authorizer: OAuthAuthorizer): void {
  activeAuthorizer = authorizer;
}

// ---------------------------------------------------------------------------
// Redirect URI + popup callback
// ---------------------------------------------------------------------------

/** Redirect URI for the active platform (web page, desktop loopback, or deep link). */
export function redirectUri(): string {
  return activeAuthorizer.redirectUri();
}

/**
 * Run once at app startup. If this page is an OAuth popup carrying our sentinel
 * `state`, forward the result to the opener and close. No-op otherwise.
 */
export function initOAuthCallback(): void {
  if (typeof window === 'undefined' || !window.opener) return;

  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
  const code = url.searchParams.get('code') ?? hashParams.get('code');
  const error = url.searchParams.get('error') ?? hashParams.get('error');
  const state = url.searchParams.get('state') ?? hashParams.get('state');

  if (!code && !error) return;
  // Only act on our own redirects (sentinel prefix baked into `state`).
  if (!state || !state.startsWith(STATE_PREFIX)) return;

  const message: OAuthCallbackMessage = {
    keeweb_oauth: true,
    code: code ?? undefined,
    error: error ?? undefined,
    state
  };
  try {
    window.opener.postMessage(message, location.origin);
  } catch {
    // ignore — opener may be gone
  }
  window.close();
}

function isCallbackMessage(data: unknown): data is OAuthCallbackMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { keeweb_oauth?: unknown }).keeweb_oauth === true
  );
}

/** Opens the auth popup and resolves with the authorization code. */
function openPopupAndAwaitCode(authUrl: string, expectedState: string): Promise<OAuthAuthorizeResult> {
  return new Promise<OAuthAuthorizeResult>((resolve, reject) => {
    const popup = window.open(authUrl, 'keeweb-oauth', 'width=600,height=720,menubar=no,toolbar=no');
    if (!popup) {
      reject(new Error('Unable to open sign-in popup. Please allow popups and try again.'));
      return;
    }

    let settled = false;
    const cleanup = (): void => {
      window.removeEventListener('message', onMessage);
      window.clearInterval(closedTimer);
    };

    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== location.origin) return;
      if (!isCallbackMessage(event.data)) return;
      if (event.data.state !== expectedState) return;
      settled = true;
      cleanup();
      try {
        popup.close();
      } catch {
        // ignore
      }
      if (event.data.error) {
        reject(new Error(`OAuth sign-in failed: ${event.data.error}`));
      } else if (event.data.code) {
        resolve({ code: event.data.code, state: event.data.state });
      } else {
        reject(new Error('OAuth sign-in returned no authorization code.'));
      }
    };

    const closedTimer = window.setInterval(() => {
      if (popup.closed && !settled) {
        settled = true;
        cleanup();
        reject(new Error('Sign-in was cancelled.'));
      }
    }, 500);

    window.addEventListener('message', onMessage);
  });
}

// ---------------------------------------------------------------------------
// Token persistence (secret store, per provider)
//
// Token sets go through the pluggable secret store: OS-keychain-backed on
// desktop (safeStorage) and mobile (Keystore/Keychain), prefixed localStorage
// on the web. The store's in-memory cache keeps `getToken`/`isTokenValid`
// synchronous — main.ts awaits `hydrateOAuthTokens()`/`secretStore.preload()`
// before mount, so the cache is warm before any provider is used.
// ---------------------------------------------------------------------------

function parseStoredToken(raw: string | null): StoredToken | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredToken>;
    if (typeof parsed.access_token !== 'string' || typeof parsed.expiry !== 'number') {
      return null;
    }
    return {
      access_token: parsed.access_token,
      refresh_token: typeof parsed.refresh_token === 'string' ? parsed.refresh_token : undefined,
      expiry: parsed.expiry
    };
  } catch {
    return null;
  }
}

/** Sync read from the preloaded secret cache. */
export function getToken(provider: OAuthProviderId): StoredToken | null {
  return parseStoredToken(secretStore.getCached(oauthTokenKey(provider)));
}

/** Async read that also works before the cache is hydrated. */
async function loadToken(provider: OAuthProviderId): Promise<StoredToken | null> {
  return parseStoredToken(await secretStore.get(oauthTokenKey(provider)));
}

export function setToken(provider: OAuthProviderId, token: StoredToken): Promise<void> {
  return secretStore.set(oauthTokenKey(provider), JSON.stringify(token));
}

export function clearToken(provider: OAuthProviderId): Promise<void> {
  return secretStore.remove(oauthTokenKey(provider));
}

/** Warm the token cache from the secret backend (awaited at startup). */
export function hydrateOAuthTokens(): Promise<void> {
  return secretStore.preload(OAUTH_PROVIDER_IDS.map(oauthTokenKey));
}

/** True when a non-expired access token is currently held. */
export function isTokenValid(provider: OAuthProviderId): boolean {
  const token = getToken(provider);
  return !!token && Date.now() < token.expiry - EXPIRY_SKEW_MS;
}

function toStoredToken(res: TokenResponse): StoredToken {
  const expiresInSec = typeof res.expires_in === 'number' ? res.expires_in : 3600;
  return {
    access_token: res.access_token,
    refresh_token: res.refresh_token,
    expiry: Date.now() + expiresInSec * 1000
  };
}

async function parseTokenResponse(res: Response): Promise<StoredToken> {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OAuth token request failed: ${res.status} ${res.statusText} ${text}`.trim());
  }
  const json = (await res.json()) as TokenResponse;
  if (!json.access_token) {
    throw new Error('OAuth token response missing access_token.');
  }
  return toStoredToken(json);
}

// ---------------------------------------------------------------------------
// Authorization flow + refresh
// ---------------------------------------------------------------------------

/**
 * All providers run as OAuth *public clients* with PKCE — no client_secret
 * anywhere in this app: it would be readable by anyone in the shipped bundle,
 * so it provides no security and only risks leaking a real secret.
 */
export interface OAuthFlowConfig {
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  scope: string;
  redirectUri: string;
  usePkce: boolean;
  /** Provider-specific extra query params for the authorize URL. */
  extraAuthParams?: Record<string, string>;
}

/** Runs the full Authorization Code (+ PKCE) flow, returning a token set. */
export async function oauthFlow(config: OAuthFlowConfig): Promise<StoredToken> {
  const state = `${STATE_PREFIX}${randomToken(16)}`;
  const pkce = config.usePkce ? await generatePkce() : undefined;

  sessionStorage.setItem(STATE_KEY, state);
  if (pkce) sessionStorage.setItem(VERIFIER_KEY, pkce.verifier);

  const authParams = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scope,
    state
  });
  for (const [key, value] of Object.entries(config.extraAuthParams ?? {})) {
    authParams.set(key, value);
  }
  if (pkce) {
    authParams.set('code_challenge', pkce.challenge);
    authParams.set('code_challenge_method', 'S256');
  }

  const result = await activeAuthorizer.authorize(`${config.authUrl}?${authParams.toString()}`, state);

  // CSRF / authorization-code-injection guard: the code is only accepted when
  // the redirect echoed the exact state we generated for THIS flow. Validated
  // centrally so the desktop (Electron child window) and mobile (deep link)
  // authorizers get the same protection as the web popup.
  if (result.state !== state) {
    sessionStorage.removeItem(STATE_KEY);
    sessionStorage.removeItem(VERIFIER_KEY);
    throw new Error('OAuth sign-in failed: state mismatch (possible CSRF). Please try again.');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: result.code,
    client_id: config.clientId,
    redirect_uri: config.redirectUri
  });
  if (config.usePkce) {
    const verifier = sessionStorage.getItem(VERIFIER_KEY);
    if (verifier) body.set('code_verifier', verifier);
  }

  try {
    const res = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    return await parseTokenResponse(res);
  } finally {
    sessionStorage.removeItem(STATE_KEY);
    sessionStorage.removeItem(VERIFIER_KEY);
  }
}

export interface RefreshConfig {
  tokenUrl: string;
  clientId: string;
  refreshToken: string;
}

/** Exchanges a refresh token for a fresh access token. */
export async function refreshToken(config: RefreshConfig): Promise<StoredToken> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: config.refreshToken,
    client_id: config.clientId
  });

  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  return parseTokenResponse(res);
}

export interface TokenEndpointConfig {
  tokenUrl: string;
  clientId: string;
}

/**
 * Returns a currently-valid access token for `provider`, auto-refreshing when
 * expired. Throws a clear Error when the user is not signed in or the session
 * can no longer be refreshed (in which case the stored token is cleared).
 */
export async function getValidAccessToken(
  provider: OAuthProviderId,
  config: TokenEndpointConfig
): Promise<string> {
  const token = await loadToken(provider);
  if (!token) {
    throw new Error('Not signed in. Please sign in first.');
  }
  if (Date.now() < token.expiry - EXPIRY_SKEW_MS) {
    return token.access_token;
  }
  if (!token.refresh_token) {
    await clearToken(provider);
    throw new Error('Session expired, please sign in again.');
  }
  try {
    const refreshed = await refreshToken({
      tokenUrl: config.tokenUrl,
      clientId: config.clientId,
      refreshToken: token.refresh_token
    });
    const merged: StoredToken = {
      access_token: refreshed.access_token,
      // Refresh responses often omit a new refresh token — keep the old one.
      refresh_token: refreshed.refresh_token ?? token.refresh_token,
      expiry: refreshed.expiry
    };
    await setToken(provider, merged);
    return merged.access_token;
  } catch {
    await clearToken(provider);
    throw new Error('Session expired, please sign in again.');
  }
}
