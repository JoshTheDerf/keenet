# KeeNet — Vue 3 password manager

A ground-up rewrite of [KeeWeb](https://github.com/keeweb/keeweb), the free
cross-platform password manager compatible with KeePass (`.kdbx`), on a modern
front-end stack. TypeScript everywhere. Rebranded **KeeNet** — a continuation of
the KeeWeb project under new maintenance and its own domain/OAuth apps.

## Stack

- **Vue 3.5** (`<script setup lang="ts">`) + **Pinia** state
- **Nuxt UI 4.9** (standalone Vue mode) + **Tailwind CSS v4**
- **Vite 6** build pipeline
- **kdbxweb** for KeePass crypto, **hash-wasm** Argon2 (KDBX4 KDF)
- **zxcvbn** password strength, Web Crypto TOTP/HOTP
- **Vitest** unit tests + **vue-tsc** type checking

## Scripts

```bash
npm ci              # install (always from the lockfile)
npm run dev         # Vite dev server
npm run build       # vue-tsc --noEmit && vite build  → dist/
npm run preview     # preview the production build
npm run typecheck   # vue-tsc --noEmit
npm run lint        # eslint (flat config)
npm run audit       # npm audit --omit=dev
npm test            # vitest run
```

## Architecture

```
src/
  domain/      kdbx wrapper, mappers, generator, strength, otp, search  (pure, tested)
  stores/      pinia: vault (files/entries/selection), settings, ui
  storage/     local (File System Access), webdav, indexeddb cache
  components/
    open/      unlock / create / demo / webdav open screen
    layout/    titlebar + 3-pane shell
    menu/      groups tree, tags, colors, trash
    list/      search bar, entry list (list + table modes)
    details/   entry editor: fields, password, tags, custom, otp, attachments, history
    generator/ password generator
    settings/  appearance/themes, function, audit, files, about, help, shortcuts
    shared/    icon, color dot, strength bar
  i18n/        en-US / de-DE / fr-FR
  const/       KeePass icon map, color palette
```

The kdbxweb `Kdbx` object is the single source of truth; the UI renders plain
view-models projected by `KdbxFile` and re-derived after every mutation (see
`CONTRACT.md`).

## Feature coverage

Databases: open / create / demo · master password + key file · **KDBX 3.1,
4.0, 4.1** (new files are 4.1) with **format conversion + upgrade** · Argon2d/
Argon2id/AES KDF conversion.

Entries: full CRUD · protected & custom fields · **field references
(`{REF:...}`)** · attachments · TOTP/HOTP live codes (+ **QR scan**) · multiple
URLs (KP2A) · tags · colors · expiry · KeePass icons · history (revert/delete) ·
clone · **auto-type sequence editor** · **entry templates** · trash + **restore**.

Views: groups tree · tags (rename/delete) · colors · trash · **expired** filter ·
text/case/regex/protected search · sorting · list & table modes · responsive
mobile layout · **markdown notes**.

Tools: **command palette (Ctrl/Cmd+K)** — actions + jump-to-entry · password
generator (presets incl. **user presets & derive-from-password**, char sets,
entropy) · **password audit** (weak/duplicate/old) + **Have I Been Pwned**
(k-anonymity) · 12 themes (auto light/dark) · i18n (en/de/fr) · **keyboard
shortcuts** (Ctrl+K/F/N/S/L/G/B/C, Ctrl+,) · **auto-lock** (idle / tab-hidden /
OS-lock) · full keyboard navigation of menu tree and entry list.

Storage & sync: local file (File System Access) · **Local Folder** (persistent
dir handle) · WebDAV · **Dropbox / Google Drive / OneDrive** (OAuth PKCE) ·
pull→**merge**→push sync · auto-save + interval · rotating **backups** (IndexedDB) ·
**CSV import** (column mapping) · **import/merge another KDBX** · **XML + HTML
export**.

Desktop (**Electron**): native local-file open/save · system **tray** +
minimize/close-to-tray · **powerMonitor** lock on OS-lock/suspend · **global
shortcuts** · native clipboard auto-clear · **auto-type** (OS keystroke
injection via an optional native module).

## Security

- **Sanitized rendering**: entry notes (markdown) are sanitized with DOMPurify
  (allowlist profile, http(s)/mailto links only, forced
  `rel="noopener noreferrer"`); vault content is treated as untrusted input.
- **Content-Security-Policy**: strict CSP in the built `index.html`
  (`default-src 'self'`, no inline/eval scripts; `wasm-unsafe-eval` only for
  Argon2), relaxed automatically in dev; re-enforced in Electron via response
  headers.
- **Electron hardening**: `sandbox: true` + `contextIsolation`, minimal typed
  preload bridge, deny-all `setWindowOpenHandler` (external links open in the OS
  browser), `will-navigate` locked to the app origin, and file read/write IPC
  restricted to paths granted through native dialogs (grants persisted by the
  main process only).
- **OAuth**: dependency-free PKCE (S256) as **public clients** — no client
  secrets in the bundle; `state` validated on web, desktop, and mobile flows.
- **Secret storage**: OAuth tokens and the WebDAV password are kept in the OS
  keychain — Electron `safeStorage` on desktop, Keystore/Keychain on mobile —
  never in plaintext files; on web they stay in localStorage (no keychain
  exists there) with the strict CSP/XSS hardening as the mitigating control,
  and legacy plaintext values are migrated and scrubbed on first run.
- **HIBP**: k-anonymity (only a 5-char SHA-1 prefix leaves the device), with
  response padding.
- **Supply chain**: all dependencies pinned to exact versions (`save-exact`),
  lockfile installs via `npm ci`, `npm run audit` script, no postinstall
  scripts, no network access in build scripts; the optional native auto-type
  module resolves only from the app's own `node_modules`.
- Backups and offline cache store **ciphertext only**; the master password is
  never persisted.

Known upstream advisories (tracked, not fixable here without downgrades):
`kdbxweb`'s bundled `@xmldom/xmldom`, and a dev-only esbuild advisory.

Intentionally out of scope: the KeeWeb **plugin system** and the **browser-
extension native-messaging connector** (a separate companion app). Desktop
cross-app auto-type requires installing an optional native keystroke module
(`@nut-tree-fork/nut-js` or `robotjs`); it's wired end-to-end and degrades
gracefully when absent.

## Desktop build

```bash
npm run electron:start   # build web + launch Electron
npm run electron:dev     # Electron against the Vite dev server
npm run electron:build   # package with electron-builder (dmg/nsis/AppImage)
```

## PWA

The web build is an installable, offline-capable PWA (vite-plugin-pwa / Workbox):
web app manifest + maskable icons, an auto-updating service worker that
precaches the app shell (external calls — HIBP, cloud providers, OAuth — are
always network and never intercepted). Install from the browser's "Install app"
prompt; it launches standalone and works offline. The service worker is skipped
inside the Electron and native mobile shells (they load bundled assets).

## Mobile build (Capacitor)

Native Android/iOS apps wrap the same build in a WebView with a native bridge:
local-file storage (`@capacitor/filesystem`), native clipboard with auto-clear,
**biometric unlock** on resume (`capacitor-native-biometric`), status bar,
Android back-button, and haptics. Auto-type parses/emits the same sequences
(cross-app injection isn't possible in the mobile sandbox — copy works).

```bash
npm run cap:add:android   # scaffold the native android/ project (done once)
npm run cap:android       # build web + sync + open in Android Studio
npm run cap:ios           # (on macOS) build web + sync + open in Xcode
npm run cap:sync          # rebuild web + copy assets/plugins into native projects
```

Building the APK/IPA needs the platform SDKs (Android Studio/JDK, or
Xcode/CocoaPods on macOS); the `android/` project is generated and synced.

## Deployment

Built to `dist/` and served as a static SPA at **/keeweb** behind Caddy
(see `../compose`): the build uses a relative base (`base: './'`), so Caddy's
`handle_path /keeweb/*` prefix-strip resolves assets correctly. Live at
https://thederf.com/keeweb.

The original 1.x source is preserved under `_legacy/` for reference.
