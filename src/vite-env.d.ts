/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Public base path for the build (default './'). Read in vite.config, not client code. */
  readonly VITE_BASE_URL?: string;

  /** OAuth client ids — baked in at build time (optional; overridable at runtime).
   * PKCE public clients only: client secrets are never read or embedded. */
  readonly VITE_DROPBOX_CLIENT_ID?: string;
  readonly VITE_GDRIVE_CLIENT_ID?: string;
  readonly VITE_ONEDRIVE_CLIENT_ID?: string;

  /** OAuth redirect URIs for the packaged apps (defaults per platform). */
  readonly VITE_OAUTH_DESKTOP_REDIRECT_URI?: string;
  readonly VITE_OAUTH_MOBILE_REDIRECT_URI?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
