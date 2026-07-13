/**
 * Tauri desktop bridge.
 *
 * Reconstructs the exact `window.keeweb` (KeeWebDesktopApi) surface the renderer
 * expects — the same contract the Electron preload used to expose — but backed
 * by Tauri commands (see `src-tauri/src/lib.rs`). Installed from `main.ts` only
 * when running inside the Tauri webview, so the rest of the app is unchanged and
 * `isDesktop()` (which tests for `window.keeweb`) keeps working verbatim.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getVersion } from '@tauri-apps/api/app';
import type { DesktopFileInfo, KeeWebDesktopApi } from '@/types/desktop';

/** number[] (JSON-serialised Vec<u8>) → a standalone ArrayBuffer. */
function toArrayBuffer(bytes: number[] | Uint8Array | null | undefined): ArrayBuffer {
  if (!bytes) return new ArrayBuffer(0);
  return Uint8Array.from(bytes).buffer;
}

/** ArrayBuffer / typed array → number[] for JSON transport to a Vec<u8> param. */
function toBytes(data: ArrayBuffer | Uint8Array): number[] {
  const view = data instanceof Uint8Array ? data : new Uint8Array(data);
  return Array.from(view);
}

/** Coarse Node-style platform string (the API declares it, no consumer branches on it). */
function guessPlatform(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/Mac/i.test(ua)) return 'darwin';
  if (/Win/i.test(ua)) return 'win32';
  return 'linux';
}

export async function installTauriBridge(): Promise<void> {
  let version = '';
  try {
    version = await getVersion();
  } catch {
    /* non-fatal */
  }

  const api: KeeWebDesktopApi = {
    version,
    platform: guessPlatform(),

    async openFileDialog(): Promise<DesktopFileInfo | null> {
      const res = await invoke<{ path: string; name: string; data: number[] } | null>('file_open');
      if (!res) return null;
      return { path: res.path, name: res.name, data: toArrayBuffer(res.data) };
    },

    async readFile(path: string): Promise<ArrayBuffer> {
      const bytes = await invoke<number[]>('file_read', { path });
      return toArrayBuffer(bytes);
    },

    async writeFile(path: string, data: ArrayBuffer): Promise<void> {
      await invoke('file_write', { path, data: toBytes(data) });
    },

    async saveFileDialog(suggestedName: string, data: ArrayBuffer): Promise<string | null> {
      return invoke<string | null>('file_save_dialog', { suggestedName, data: toBytes(data) });
    },

    async copyText(text: string, clearAfterMs?: number): Promise<void> {
      await invoke('clipboard_copy', { text, clearAfterMs });
    },

    async autoType(ops): Promise<void> {
      await invoke('autotype_run', { ops });
    },

    async autoTypeAvailable(): Promise<boolean> {
      return invoke<boolean>('autotype_available');
    },

    async oauthAuthorize(req): Promise<{ code?: string; error?: string; state?: string }> {
      const res = await invoke<{ code?: string | null; error?: string | null; state?: string | null }>(
        'oauth_authorize',
        { req }
      );
      return {
        code: res.code ?? undefined,
        error: res.error ?? undefined,
        state: res.state ?? undefined
      };
    },

    async secretGet(key: string): Promise<string | null> {
      return invoke<string | null>('secret_get', { key });
    },

    async secretSet(key: string, value: string): Promise<void> {
      await invoke('secret_set', { key, value });
    },

    async secretDelete(key: string): Promise<void> {
      await invoke('secret_delete', { key });
    },

    minimizeToTray(): void {
      void invoke('window_minimize_to_tray');
    },

    toggleWindow(): void {
      void invoke('window_toggle');
    },

    on(channel, cb): () => void {
      let unlisten: UnlistenFn | undefined;
      let cancelled = false;
      void listen(channel, (event) => cb(event.payload)).then((un) => {
        if (cancelled) un();
        else unlisten = un;
      });
      return () => {
        cancelled = true;
        unlisten?.();
      };
    }
  };

  window.keeweb = api;
}
