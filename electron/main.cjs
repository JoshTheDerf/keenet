/**
 * KeeNet desktop (Electron) main process.
 *
 * Plain CommonJS — no bundling/typecheck. Loads the Vite dev server when
 * KEEWEB_DEV_URL is set, otherwise the built web app from ../dist.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  clipboard,
  session,
  shell,
  Tray,
  Menu,
  nativeImage,
  powerMonitor,
  globalShortcut,
  safeStorage
} = require('electron');

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {Tray | null} */
let tray = null;
let isQuitting = false;

const DEV_URL = process.env.KEEWEB_DEV_URL;

/** file:// URL of the built app entry (what the window loads in production). */
const APP_ENTRY_URL = pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href;

// ---------------------------------------------------------------------------
// Renderer file-access grants
//
// The renderer may only read/write paths the USER has granted through a native
// dialog in the main process (`file:open` / `file:saveDialog`). Arbitrary paths
// coming over IPC are rejected, so a compromised renderer cannot exfiltrate or
// overwrite arbitrary files.
//
// "Remembered file" reopen: the app legitimately reopens previously used .kdbx
// paths at startup without showing a dialog again. To keep that working we
// persist the grant list — written ONLY by the main process, in userData — and
// re-grant exactly those paths on startup. This is the tightest option: the
// renderer can never mint a grant (unlike an extension/existence check, which
// would let it read any *.kdbx/*.key on disk), and every persisted path was at
// some point explicitly chosen by the user in a native file dialog.
// ---------------------------------------------------------------------------

/** @type {Set<string>} resolved absolute paths the renderer may read/write. */
const grantedPaths = new Set();
const GRANTS_FILE = () => path.join(app.getPath('userData'), 'granted-paths.json');
const MAX_PERSISTED_GRANTS = 100;

function loadPersistedGrants() {
  try {
    const raw = fs.readFileSync(GRANTS_FILE(), 'utf8');
    const list = JSON.parse(raw);
    if (Array.isArray(list)) {
      for (const p of list) {
        if (typeof p === 'string' && path.isAbsolute(p)) grantedPaths.add(path.resolve(p));
      }
    }
  } catch {
    /* first run or unreadable — start with no grants */
  }
}

function persistGrants() {
  try {
    const list = [...grantedPaths].slice(-MAX_PERSISTED_GRANTS);
    fs.writeFileSync(GRANTS_FILE(), JSON.stringify(list), { mode: 0o600 });
  } catch {
    /* non-fatal: grants just won't survive a restart */
  }
}

/** Record that the user granted access to `filePath` via a native dialog. */
function grantPath(filePath) {
  grantedPaths.add(path.resolve(filePath));
  persistGrants();
}

/** Throw unless `filePath` was granted via a dialog (this run or a prior one). */
function assertGranted(filePath) {
  const resolved = path.resolve(String(filePath));
  if (!grantedPaths.has(resolved)) {
    throw new Error(`Access denied: ${resolved} was not granted via a file dialog`);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Secret storage (OS keychain via safeStorage)
//
// Small secrets (OAuth token sets, WebDAV password) are encrypted with
// Electron's safeStorage — DPAPI on Windows, Keychain on macOS, kwallet /
// libsecret on Linux — and persisted as base64 blobs in userData/secrets.json,
// written ONLY by the main process with mode 0600 (same pattern as
// granted-paths.json above).
//
// WARNING (fallback): when safeStorage.isEncryptionAvailable() is false (some
// Linux setups have no gnome-keyring/kwallet, or run headless), we store the
// value base64-obfuscated instead of crashing or dropping the feature. That is
// NOT encryption — it only prevents casual grep exposure and matches the
// plaintext-localStorage trust level the app had before. Records remember how
// they were written (`enc`) so a machine that later gains a keyring still
// reads old fallback records correctly.
// ---------------------------------------------------------------------------

const SECRETS_FILE = () => path.join(app.getPath('userData'), 'secrets.json');
const MAX_SECRET_KEY_LENGTH = 128;
const MAX_SECRET_VALUE_LENGTH = 64 * 1024;

/** @type {Record<string, { enc: boolean, v: string }> | null} */
let secrets = null;

function loadSecrets() {
  if (secrets) return secrets;
  secrets = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(SECRETS_FILE(), 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) secrets = parsed;
  } catch {
    /* first run or unreadable — start empty */
  }
  return secrets;
}

function persistSecrets() {
  fs.writeFileSync(SECRETS_FILE(), JSON.stringify(secrets), { mode: 0o600 });
}

/** Validate an IPC-supplied secret key (never trust renderer input). */
function assertSecretKey(key) {
  if (typeof key !== 'string' || !key || key.length > MAX_SECRET_KEY_LENGTH) {
    throw new Error('Invalid secret key');
  }
  return key;
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 700,
    minHeight: 500,
    show: true,
    title: 'KeeNet',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // Full Chromium sandbox: the preload only uses contextBridge/ipcRenderer
      // (no Node fs/path/Buffer), so it runs fine sandboxed.
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  // New windows are never allowed; http(s) links open in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // The app is a single-page renderer — it never navigates. Allow only the app
  // entry itself (dev server URL in dev, the built file:// entry otherwise).
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = DEV_URL ? url.startsWith(DEV_URL) : url.startsWith(APP_ENTRY_URL);
    if (!allowed) event.preventDefault();
  });

  if (DEV_URL) {
    void mainWindow.loadURL(DEV_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Minimize-to-tray.
  mainWindow.on('minimize', (e) => {
    e.preventDefault();
    mainWindow?.hide();
  });

  // Close-to-tray: hide instead of quit unless we are really quitting.
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toggleWindow() {
  if (mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized()) {
    mainWindow.hide();
  } else {
    showWindow();
  }
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------

function createTray() {
  // A 1x1 transparent image keeps the tray working without shipping an icon
  // asset; packaged builds can replace this with a real template image.
  let image = nativeImage.createEmpty();
  const iconPath = path.join(__dirname, 'tray.png');
  if (fs.existsSync(iconPath)) {
    image = nativeImage.createFromPath(iconPath);
  }

  try {
    tray = new Tray(image);
  } catch {
    // Some headless environments cannot create a tray; skip silently.
    tray = null;
    return;
  }

  const menu = Menu.buildFromTemplate([
    { label: 'Show / Hide', click: () => toggleWindow() },
    { label: 'Lock', click: () => sendToRenderer('lock', undefined) },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setToolTip('KeeNet');
  tray.setContextMenu(menu);
  tray.on('click', () => toggleWindow());
}

// ---------------------------------------------------------------------------
// Application menu
// ---------------------------------------------------------------------------

function menuItem(label, id, accelerator) {
  return {
    label,
    accelerator,
    click: () => sendToRenderer('menu-action', id)
  };
}

function buildAppMenu() {
  const isMac = process.platform === 'darwin';
  /** @type {import('electron').MenuItemConstructorOptions[]} */
  const template = [];

  if (isMac) {
    template.push({
      label: 'KeeNet',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: 'Cmd+Q',
          click: () => {
            isQuitting = true;
            app.quit();
          }
        }
      ]
    });
  }

  template.push({
    label: 'File',
    submenu: [
      menuItem('Open…', 'open', 'CmdOrCtrl+O'),
      menuItem('New', 'new', 'CmdOrCtrl+N'),
      menuItem('Save', 'save', 'CmdOrCtrl+S'),
      { type: 'separator' },
      menuItem('Lock', 'lock', 'CmdOrCtrl+L'),
      { type: 'separator' },
      isMac
        ? { role: 'close' }
        : {
            label: 'Quit',
            accelerator: 'Ctrl+Q',
            click: () => {
              isQuitting = true;
              app.quit();
            }
          }
    ]
  });

  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' }
    ]
  });

  template.push({
    label: 'View',
    submenu: [
      menuItem('Generate Password…', 'generate', 'CmdOrCtrl+G'),
      menuItem('Settings…', 'settings', 'CmdOrCtrl+,'),
      { type: 'separator' },
      { role: 'reload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' }
    ]
  });

  template.push({
    label: 'Window',
    submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? [{ role: 'front' }] : [{ role: 'close' }])]
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// Auto-type via an OPTIONAL native module (loaded lazily, never a dep).
// ---------------------------------------------------------------------------

let autoTypeBackend = undefined; // undefined = not resolved yet, null = unavailable

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Load an OPTIONAL native module, resolving it ONLY from the app's own
 * node_modules. Trust decision: these modules are not dependencies — the user
 * (or packager) opts in by installing them into the app root. Pinning the
 * resolution paths to the app's node_modules prevents Node's default upward
 * directory walk from picking up a same-named module planted anywhere else on
 * disk (e.g. a world-writable parent directory).
 * @returns {object | null}
 */
function requireOptionalFromAppRoot(name) {
  try {
    const resolved = require.resolve(name, {
      paths: [path.join(__dirname, '..', 'node_modules')]
    });
    return require(resolved);
  } catch {
    return null;
  }
}

/**
 * Resolve a keystroke backend once. Prefers @nut-tree-fork/nut-js, falls back
 * to robotjs. Neither is declared in package.json — auto-type is best-effort.
 * @returns {object | null}
 */
function resolveAutoTypeBackend() {
  if (autoTypeBackend !== undefined) return autoTypeBackend;

  // nut.js
  const nut = requireOptionalFromAppRoot('@nut-tree-fork/nut-js');
  if (nut) {
    autoTypeBackend = {
      kind: 'nut',
      async typeString(text) {
        await nut.keyboard.type(text);
      },
      async tap(keyName) {
        const key = nut.Key[keyName];
        if (key !== undefined) {
          await nut.keyboard.pressKey(key);
          await nut.keyboard.releaseKey(key);
        }
      }
    };
    return autoTypeBackend;
  }

  // robotjs
  const robot = requireOptionalFromAppRoot('robotjs');
  if (robot) {
    autoTypeBackend = {
      kind: 'robotjs',
      async typeString(text) {
        robot.typeString(text);
      },
      async tap(keyName) {
        robot.keyTap(keyName);
      }
    };
    return autoTypeBackend;
  }

  autoTypeBackend = null;
  return autoTypeBackend;
}

// Map our AutoTypeOp key tokens → nut.js Key member names.
const NUT_KEY_MAP = {
  TAB: 'Tab',
  ENTER: 'Enter',
  SPACE: 'Space',
  UP: 'Up',
  DOWN: 'Down',
  LEFT: 'Left',
  RIGHT: 'Right',
  HOME: 'Home',
  END: 'End',
  INSERT: 'Insert',
  DELETE: 'Delete',
  BACKSPACE: 'Backspace',
  ESC: 'Escape',
  ESCAPE: 'Escape',
  PGUP: 'PageUp',
  PGDN: 'PageDown'
};

// robotjs uses lowercase key names.
const ROBOT_KEY_MAP = {
  TAB: 'tab',
  ENTER: 'enter',
  SPACE: 'space',
  UP: 'up',
  DOWN: 'down',
  LEFT: 'left',
  RIGHT: 'right',
  HOME: 'home',
  END: 'end',
  INSERT: 'insert',
  DELETE: 'delete',
  BACKSPACE: 'backspace',
  ESC: 'escape',
  ESCAPE: 'escape',
  PGUP: 'pageup',
  PGDN: 'pagedown'
};

async function runAutoType(ops) {
  const backend = resolveAutoTypeBackend();
  if (!backend) {
    throw new Error('Auto-type requires the native module (not installed)');
  }
  const keyMap = backend.kind === 'nut' ? NUT_KEY_MAP : ROBOT_KEY_MAP;
  // Give the previously focused window a moment to regain focus.
  await sleep(200);
  for (const op of ops || []) {
    if (op.type === 'text' && op.text) {
      await backend.typeString(op.text);
    } else if (op.type === 'key' && op.key) {
      const mapped = keyMap[String(op.key).toUpperCase()];
      if (mapped) await backend.tap(mapped);
    } else if (op.type === 'delay') {
      await sleep(Number(op.ms) || 0);
    }
  }
}

// ---------------------------------------------------------------------------
// Clipboard with native auto-clear
// ---------------------------------------------------------------------------

function copyText(text, clearAfterMs) {
  clipboard.writeText(text);
  if (clearAfterMs && clearAfterMs > 0) {
    setTimeout(() => {
      // Only clear if the clipboard still holds what we wrote (don't clobber
      // something the user copied in the meantime).
      if (clipboard.readText() === text) clipboard.clear();
    }, clearAfterMs);
  }
}

// ---------------------------------------------------------------------------
// IPC bridge
// ---------------------------------------------------------------------------

function registerIpc() {
  ipcMain.handle('file:open', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Open KeePass database',
      properties: ['openFile'],
      filters: [
        { name: 'KeePass database', extensions: ['kdbx'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    const filePath = res.filePaths[0];
    grantPath(filePath);
    const buf = await fs.promises.readFile(filePath);
    return { path: filePath, name: path.basename(filePath), data: buf };
  });

  // Read/write are restricted to dialog-granted paths — see the grants block
  // at the top of this file.
  ipcMain.handle('file:read', async (_e, filePath) => {
    return fs.promises.readFile(assertGranted(filePath));
  });

  ipcMain.handle('file:write', async (_e, filePath, data) => {
    await fs.promises.writeFile(assertGranted(filePath), Buffer.from(data));
  });

  ipcMain.handle('file:saveDialog', async (_e, suggestedName, data) => {
    const res = await dialog.showSaveDialog({
      title: 'Save KeePass database',
      defaultPath: suggestedName,
      filters: [{ name: 'KeePass database', extensions: ['kdbx'] }]
    });
    if (res.canceled || !res.filePath) return null;
    grantPath(res.filePath);
    await fs.promises.writeFile(res.filePath, Buffer.from(data));
    return res.filePath;
  });

  ipcMain.handle('clipboard:copy', async (_e, text, clearAfterMs) => {
    copyText(String(text ?? ''), clearAfterMs);
  });

  ipcMain.handle('autotype:available', async () => {
    return resolveAutoTypeBackend() !== null;
  });

  ipcMain.handle('autotype:run', async (_e, ops) => {
    await runAutoType(ops);
  });

  // Secret storage — see the safeStorage block at the top of this file.
  ipcMain.handle('secrets:get', (_e, key) => {
    const store = loadSecrets();
    const rec = store[assertSecretKey(key)];
    if (!rec || typeof rec.v !== 'string') return null;
    try {
      if (rec.enc) return safeStorage.decryptString(Buffer.from(rec.v, 'base64'));
      return Buffer.from(rec.v, 'base64').toString('utf8');
    } catch {
      // Keyring unavailable or OS key changed — treat as absent.
      return null;
    }
  });

  ipcMain.handle('secrets:set', (_e, key, value) => {
    assertSecretKey(key);
    if (typeof value !== 'string' || value.length > MAX_SECRET_VALUE_LENGTH) {
      throw new Error('Invalid secret value');
    }
    const store = loadSecrets();
    if (safeStorage.isEncryptionAvailable()) {
      store[key] = { enc: true, v: safeStorage.encryptString(value).toString('base64') };
    } else {
      // Base64 obfuscation fallback — see the WARNING in the safeStorage block.
      store[key] = { enc: false, v: Buffer.from(value, 'utf8').toString('base64') };
    }
    persistSecrets();
  });

  ipcMain.handle('secrets:delete', (_e, key) => {
    const store = loadSecrets();
    if (assertSecretKey(key) in store) {
      delete store[key];
      persistSecrets();
    }
  });

  ipcMain.handle('window:minimizeToTray', () => {
    mainWindow?.hide();
  });

  ipcMain.handle('window:toggle', () => {
    toggleWindow();
  });

  // OAuth: open the provider auth page in a modal child window and resolve once
  // it redirects to our redirect URI. The redirect URI (https://localhost/...)
  // never actually loads — we read the code off the query before/at navigation.
  ipcMain.handle('oauth:authorize', (_e, req) => {
    return new Promise((resolve) => {
      const authUrl = req && req.authUrl;
      const redirectUri = req && req.redirectUri;
      if (!authUrl || !redirectUri) {
        resolve({ error: 'invalid_request' });
        return;
      }

      let authWin = new BrowserWindow({
        width: 600,
        height: 720,
        parent: mainWindow || undefined,
        modal: !!mainWindow,
        autoHideMenuBar: true,
        title: 'Sign in',
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
      });

      // The sign-in window must never spawn further windows (popups/ads/etc.).
      authWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        try {
          if (authWin && !authWin.isDestroyed()) authWin.close();
        } catch {
          /* already gone */
        }
        resolve(result);
      };

      const handleUrl = (url) => {
        if (!url || url.indexOf(redirectUri) !== 0) return false;
        let parsed;
        try {
          parsed = new URL(url);
        } catch {
          return false;
        }
        const hash = new URLSearchParams((parsed.hash || '').replace(/^#/, ''));
        finish({
          code: parsed.searchParams.get('code') || hash.get('code') || undefined,
          error: parsed.searchParams.get('error') || hash.get('error') || undefined,
          state: parsed.searchParams.get('state') || hash.get('state') || undefined
        });
        return true;
      };

      const onNavigate = (event, url) => {
        if (handleUrl(url)) {
          try {
            event.preventDefault();
          } catch {
            /* noop */
          }
        }
      };

      authWin.webContents.on('will-redirect', onNavigate);
      authWin.webContents.on('will-navigate', onNavigate);
      // The redirect target (https://localhost/...) has nothing listening, so
      // navigation fails after the query is already visible — catch it here.
      authWin.webContents.on('did-fail-load', (_ev, _code, _desc, validatedUrl) => {
        handleUrl(validatedUrl);
      });
      authWin.on('closed', () => {
        authWin = null;
        finish({ error: 'cancelled' });
      });

      authWin.loadURL(authUrl).catch((err) => {
        finish({ error: String((err && err.message) || err) });
      });
    });
  });
}

// ---------------------------------------------------------------------------
// System integration
// ---------------------------------------------------------------------------

/**
 * Defense-in-depth CSP, mirroring the <meta http-equiv> tag in index.html
 * (which is what actually protects the file:// production load — file:// responses
 * do not reliably pass through webRequest). Applied only to the app's own
 * top-level document so provider pages in the OAuth sign-in window keep their
 * own policies. In dev, HMR needs ws: websockets.
 */
function registerCsp() {
  const connect = ["'self'", 'https:'].concat(DEV_URL ? ['ws:', 'http://localhost:*'] : []);
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `connect-src ${connect.join(' ')}`
  ].join('; ');

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const isAppDocument =
      details.resourceType === 'mainFrame' &&
      (DEV_URL ? details.url.startsWith(DEV_URL) : details.url.startsWith('file://'));
    if (!isAppDocument) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    });
  });
}

function registerPowerMonitor() {
  const lock = () => sendToRenderer('lock', undefined);
  powerMonitor.on('lock-screen', lock);
  powerMonitor.on('suspend', lock);
}

function registerGlobalShortcuts() {
  globalShortcut.register('CmdOrCtrl+Shift+K', () => toggleWindow());
  globalShortcut.register('CmdOrCtrl+Shift+A', () => sendToRenderer('auto-type-request', undefined));
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    loadPersistedGrants();
    registerCsp();
    registerIpc();
    createWindow();
    createTray();
    buildAppMenu();
    registerPowerMonitor();
    registerGlobalShortcuts();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });

  // Keep running in the tray when all windows are closed (all platforms).
  app.on('window-all-closed', () => {
    // Intentionally do not quit; the tray keeps the app alive. Quit is explicit.
  });
}
