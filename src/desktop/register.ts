/**
 * Desktop bootstrap. Safe to call unconditionally from main.ts: it is a no-op in
 * the browser and only wires native integrations when the `window.keeweb` bridge
 * is present (installed by `@/desktop/tauri-bridge` under the Tauri shell).
 */
import { isDesktop } from '@/composables/useDesktop';
import { t } from '@/i18n';
import { setClipboardWriter } from '@/composables/useClipboard';
import { registerProvider } from '@/storage';
import { desktopFileProvider } from '@/storage/desktop-file';
import { setOAuthAuthorizer } from '@/storage/oauth';
import { registerSecretBackend } from '@/storage/secret-store';
import { registerAutoTypeEmitter } from '@/domain/auto-type';
import type { AutoTypeOp } from '@/domain/auto-type';

/**
 * Redirect URI used for desktop OAuth. It never actually loads — the Tauri
 * backend intercepts the redirect to this URL in the sign-in window and reads
 * the code off the query string. Register this exact value as an allowed
 * redirect URI on each provider's OAuth app (Dropbox/Google "Web" client/Azure "Web").
 */
const DESKTOP_REDIRECT_URI =
  import.meta.env.VITE_OAUTH_DESKTOP_REDIRECT_URI ?? 'https://localhost/keenet-oauth';

export function initDesktop(): void {
  if (!isDesktop()) return;

  // (a) Register the native local-file provider (reuses the `file` type).
  registerProvider(desktopFileProvider);

  // (b) Route auto-type through the native OS-level emitter.
  registerAutoTypeEmitter({
    emit: (ops: AutoTypeOp[]) => window.keeweb!.autoType(ops)
  });

  // (c) Native clipboard (mirrors src/mobile/register.ts): copies go through
  //     the OS clipboard, which works while the window is hidden/unfocused, and
  //     the backend's auto-clear checks the clipboard still holds our text
  //     before clearing (never clobbers content the user copied later).
  setClipboardWriter({ write: (text) => window.keeweb!.copyText(text) });

  // (d) Secrets (OAuth tokens, WebDAV password): stored in the OS keychain by
  //     the Rust backend (keyring crate), not in the renderer's localStorage.
  registerSecretBackend({
    get: (key) => window.keeweb!.secretGet(key),
    set: (key, value) => window.keeweb!.secretSet(key, value),
    remove: (key) => window.keeweb!.secretDelete(key)
  });

  // (e) OAuth: no same-origin popup exists in the desktop shell, so the backend
  //     opens a dedicated sign-in window and intercepts the redirect back to our
  //     URI. The returned state is passed through — oauthFlow() validates it.
  setOAuthAuthorizer({
    redirectUri: () => DESKTOP_REDIRECT_URI,
    authorize: async (authUrl, state) => {
      const res = await window.keeweb!.oauthAuthorize({
        authUrl,
        redirectUri: DESKTOP_REDIRECT_URI,
        state
      });
      if (res.error) throw new Error(`OAuth sign-in failed: ${res.error}`);
      if (!res.code) throw new Error(t('authSignInCancelled'));
      return { code: res.code, state: res.state };
    }
  });
}
