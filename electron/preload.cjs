/**
 * KeeNet desktop preload — exposes `window.keeweb` (KeeNetDesktopApi) to the
 * sandboxed renderer over contextBridge. Plain CommonJS, no bundling.
 *
 * Buffers returned by the main process arrive here as Node Buffers / Uint8Array
 * views; we normalise them to plain ArrayBuffer at the boundary so the renderer
 * only ever sees the shape declared in src/types/desktop.d.ts.
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/** Node Buffer / Uint8Array → a standalone ArrayBuffer (exact byte length). */
function toArrayBuffer(value) {
  if (value == null) return new ArrayBuffer(0);
  if (value instanceof ArrayBuffer) return value;
  // Buffer and Uint8Array both expose buffer/byteOffset/byteLength.
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  // Fallback: array-like of bytes.
  return Uint8Array.from(value).buffer;
}

/** ArrayBuffer / typed array → Uint8Array for structured-clone over IPC. */
function toBytes(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(data);
}

const api = {
  version: process.versions.electron || process.versions.node || '',
  platform: process.platform,

  async openFileDialog() {
    const res = await ipcRenderer.invoke('file:open');
    if (!res) return null;
    return { path: res.path, name: res.name, data: toArrayBuffer(res.data) };
  },

  async readFile(path) {
    const buf = await ipcRenderer.invoke('file:read', path);
    return toArrayBuffer(buf);
  },

  async writeFile(path, data) {
    await ipcRenderer.invoke('file:write', path, toBytes(data));
  },

  async saveFileDialog(suggestedName, data) {
    return ipcRenderer.invoke('file:saveDialog', suggestedName, toBytes(data));
  },

  async copyText(text, clearAfterMs) {
    await ipcRenderer.invoke('clipboard:copy', text, clearAfterMs);
  },

  async autoType(ops) {
    await ipcRenderer.invoke('autotype:run', ops);
  },

  async autoTypeAvailable() {
    return ipcRenderer.invoke('autotype:available');
  },

  async oauthAuthorize(req) {
    return ipcRenderer.invoke('oauth:authorize', req);
  },

  // OS-keychain-backed secret storage (safeStorage in the main process).
  async secretGet(key) {
    return ipcRenderer.invoke('secrets:get', key);
  },

  async secretSet(key, value) {
    await ipcRenderer.invoke('secrets:set', key, value);
  },

  async secretDelete(key) {
    await ipcRenderer.invoke('secrets:delete', key);
  },

  minimizeToTray() {
    void ipcRenderer.invoke('window:minimizeToTray');
  },

  toggleWindow() {
    void ipcRenderer.invoke('window:toggle');
  },

  on(channel, cb) {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
};

contextBridge.exposeInMainWorld('keeweb', api);
