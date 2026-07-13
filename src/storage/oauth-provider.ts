/**
 * Shared plumbing for OAuth-based cloud storage providers (Dropbox / Google
 * Drive / OneDrive). Each provider file keeps only its REST specifics; the
 * client-id config, token endpoint wiring, sign-in/sign-out and authenticated
 * fetch live here, parameterized per provider.
 *
 * All providers run as OAuth *public clients* with PKCE — no client_secret
 * anywhere in this app: it would be readable by anyone in the shipped bundle,
 * so it provides no security and only risks leaking a real secret.
 */
import {
  oauthFlow,
  getValidAccessToken,
  setToken,
  clearToken,
  isTokenValid,
  redirectUri,
  type OAuthProviderId,
  type TokenEndpointConfig
} from './oauth';

export interface OAuthProviderOptions {
  provider: OAuthProviderId;
  /** Human-readable name used in error messages ('Dropbox', 'Google Drive', …). */
  title: string;
  authUrl: string;
  tokenUrl: string;
  scope: string;
  /**
   * Build-time default client id (VITE_*_CLIENT_ID); none ships in the repo.
   * Overridable at runtime via {@link OAuthProviderAuth.configure}.
   */
  defaultClientId: string;
  /** What to add in Settings, for the 'not configured' error message. */
  credentialLabel: string;
  /** Provider-specific extra query params for the authorize URL. */
  extraAuthParams?: Record<string, string>;
}

export interface OAuthProviderAuth {
  /** Override the embedded client id (e.g. for a self-hosted origin). */
  configure(overrides: { clientId?: string }): void;
  /** `Authorization: Bearer …` header with a valid (auto-refreshed) token. */
  authHeader(): Promise<Record<string, string>>;
  /**
   * Authenticated fetch. Non-2xx responses throw an Error carrying the HTTP
   * status as a `status` property (see {@link statusOf}).
   */
  apiFetch(url: string, init?: RequestInit): Promise<Response>;
  isAuthorized(): boolean;
  authorize(): Promise<void>;
  logout(): void;
}

/** HTTP status attached to errors thrown by {@link OAuthProviderAuth.apiFetch}. */
export function statusOf(e: unknown): number | undefined {
  return typeof e === 'object' && e && 'status' in e ? (e as { status?: number }).status : undefined;
}

export function createOAuthProviderAuth(options: OAuthProviderOptions): OAuthProviderAuth {
  const clientConfig = { clientId: options.defaultClientId };

  function tokenEndpoint(): TokenEndpointConfig {
    return { tokenUrl: options.tokenUrl, clientId: clientConfig.clientId };
  }

  async function authHeader(): Promise<Record<string, string>> {
    const token = await getValidAccessToken(options.provider, tokenEndpoint());
    return { Authorization: `Bearer ${token}` };
  }

  return {
    configure(overrides: { clientId?: string }): void {
      if (overrides.clientId) clientConfig.clientId = overrides.clientId;
    },

    authHeader,

    async apiFetch(url: string, init?: RequestInit): Promise<Response> {
      const headers = { ...(await authHeader()), ...(init?.headers ?? {}) };
      const res = await fetch(url, { ...init, headers });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw Object.assign(
          new Error(`${options.title} request failed: ${res.status} ${res.statusText} ${text}`.trim()),
          { status: res.status }
        );
      }
      return res;
    },

    isAuthorized(): boolean {
      return isTokenValid(options.provider);
    },

    async authorize(): Promise<void> {
      if (!clientConfig.clientId) {
        throw new Error(
          `${options.title} is not configured. Add your ${options.credentialLabel} in Settings → Storage → Custom OAuth app keys, then reload.`
        );
      }
      const token = await oauthFlow({
        authUrl: options.authUrl,
        tokenUrl: options.tokenUrl,
        clientId: clientConfig.clientId,
        scope: options.scope,
        redirectUri: redirectUri(),
        usePkce: true,
        extraAuthParams: options.extraAuthParams
      });
      await setToken(options.provider, token);
    },

    logout(): void {
      // Clears the in-memory cache synchronously; backend delete is async.
      void clearToken(options.provider);
    }
  };
}
