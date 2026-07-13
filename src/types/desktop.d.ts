/**
 * Desktop (Electron) bridge exposed on `window.keeweb` via contextBridge.
 * Present only in the packaged/desktop build; always guard with `isDesktop()`.
 */
export interface DesktopFileInfo {
  path: string;
  name: string;
  data: ArrayBuffer;
}

export interface KeeWebDesktopApi {
  readonly version: string;
  readonly platform: NodeJS.Platform | string;

  /** Native open/save of local files by absolute path. */
  openFileDialog(): Promise<DesktopFileInfo | null>;
  readFile(path: string): Promise<ArrayBuffer>;
  writeFile(path: string, data: ArrayBuffer): Promise<void>;
  saveFileDialog(suggestedName: string, data: ArrayBuffer): Promise<string | null>;

  /** Clipboard with auto-clear handled natively. */
  copyText(text: string, clearAfterMs?: number): Promise<void>;

  /** Auto-type: inject a resolved op list into the previously focused window. */
  autoType(ops: { type: 'text' | 'key' | 'delay'; text?: string; key?: string; ms?: number }[]): Promise<void>;
  autoTypeAvailable(): Promise<boolean>;

  /**
   * OAuth: open the provider's auth page in a child window and resolve once it
   * redirects to `redirectUri`, returning the `code`/`error`/`state` params.
   */
  oauthAuthorize(req: { authUrl: string; redirectUri: string; state: string }): Promise<{
    code?: string;
    error?: string;
    state?: string;
  }>;

  /**
   * OS-keychain-backed secret storage: values are encrypted with Electron's
   * `safeStorage` in the main process and persisted to `userData/secrets.json`.
   */
  secretGet(key: string): Promise<string | null>;
  secretSet(key: string, value: string): Promise<void>;
  secretDelete(key: string): Promise<void>;

  /** Window / tray. */
  minimizeToTray(): void;
  toggleWindow(): void;

  /** Events from main → renderer. Returns an unsubscribe fn. */
  on(channel: 'lock' | 'auto-type-request' | 'menu-action', cb: (payload: unknown) => void): () => void;
}

declare global {
  interface Window {
    keeweb?: KeeWebDesktopApi;
  }
}

export {};
