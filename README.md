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

Desktop (**Tauri**): native local-file open/save · system **tray** +
close-to-tray · **global shortcuts** · native clipboard auto-clear ·
**auto-type** (OS keystroke injection via `enigo`) · OS-keychain secret storage.

## Security

- **Sanitized rendering**: entry notes (markdown) are sanitized with DOMPurify
  (allowlist profile, http(s)/mailto links only, forced
  `rel="noopener noreferrer"`); vault content is treated as untrusted input.
- **Content-Security-Policy**: strict CSP in the built `index.html`
  (`default-src 'self'`, no inline/eval scripts; `wasm-unsafe-eval` only for
  Argon2), relaxed automatically in dev; enforced in the Tauri build via
  `tauri.conf.json` (`app.security.csp`, adding `frame-ancestors 'none'`).
- **Tauri hardening**: system-webview shell (no bundled Chromium) with a
  capability allowlist, all native features behind app-defined commands, and
  file read/write commands restricted to paths granted through native dialogs
  (grants persisted only by the Rust backend). External OAuth pages open in a
  dedicated `oauth` window whose redirect navigation is intercepted, never
  loaded.
- **OAuth**: dependency-free PKCE (S256) as **public clients** — no client
  secrets in the bundle; `state` validated on web, desktop, and mobile flows.
- **Secret storage**: OAuth tokens and the WebDAV password are kept in the OS
  keychain — the `keyring` crate on desktop (Keychain / Credential Manager /
  Secret Service), Keystore/Keychain on mobile — never in plaintext files; on
  web they stay in localStorage (no keychain exists there) with the strict
  CSP/XSS hardening as the mitigating control, and legacy plaintext values are
  migrated and scrubbed on first run. On a headless Linux box with no Secret
  Service, desktop secrets fall back to a base64-obfuscated file (not
  encryption — matches the prior desktop fallback behavior).
- **HIBP**: k-anonymity (only a 5-char SHA-1 prefix leaves the device), with
  response padding.
- **Supply chain**: all JS dependencies pinned to exact versions (`save-exact`),
  lockfile installs via `npm ci`, `npm run audit` script, no postinstall
  scripts, no network access in build scripts; the Rust desktop crate pins its
  dependencies via `Cargo.lock`.
- Backups and offline cache store **ciphertext only**; the master password is
  never persisted.

Known upstream advisories (tracked, not fixable here without downgrades):
`kdbxweb`'s bundled `@xmldom/xmldom`, and a dev-only esbuild advisory.

Intentionally out of scope: the KeeWeb **plugin system** and the **browser-
extension native-messaging connector** (a separate companion app). Desktop
auto-type uses the `enigo` crate; keystroke injection is limited under Wayland
(an X11 session is recommended for auto-type on Linux).

One capability from the former Electron shell is **not yet ported**: locking the
vault automatically on OS screen-lock/suspend (there is no built-in Tauri power
monitor). The event plumbing exists (`lock` is emitted to the renderer); wiring
a platform power-event source is a tracked follow-up.

## Desktop build (Tauri)

Requires the Rust toolchain plus the platform webview dev libraries (on Ubuntu:
`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libsoup-3.0-dev`, `librsvg2-dev`,
`libayatana-appindicator3-dev`, `libxdo-dev`, and `pkg-config`).

```bash
npm run desktop:dev      # Tauri dev: launches the Rust shell against Vite HMR
npm run desktop:build    # build web + package (deb/AppImage/nsis/dmg)
npm run tauri -- icon public/icons/icon-512.png   # (re)generate platform icons,
                                                  # incl. macOS .icns / Win .ico
```

## PWA

The web build is an installable, offline-capable PWA (vite-plugin-pwa / Workbox):
web app manifest + maskable icons, an auto-updating service worker that
precaches the app shell (external calls — HIBP, cloud providers, OAuth — are
always network and never intercepted). Install from the browser's "Install app"
prompt; it launches standalone and works offline. The service worker is skipped
inside the Tauri desktop and native mobile shells (they load bundled assets).

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

## Releases & CI

Three GitHub Actions workflows: `ci.yml` validates every push/PR (typecheck ·
lint · test · web build · audit); `release-desktop.yml` builds the Tauri app for
Linux/macOS/Windows; `release-mobile.yml` builds the Capacitor Android + iOS apps
(native projects regenerated in CI). Both release workflows run on a `v*` tag or
manual dispatch and produce **unsigned** builds until signing secrets are added.
See **[docs/RELEASING.md](docs/RELEASING.md)** for how to cut a release and set up
code signing (Apple Developer, Android keystore, Windows cert) per platform.

## Deployment

Built to `dist/` and served as a static SPA at **/keeweb** behind Caddy
(see `../compose`): the build uses a relative base (`base: './'`), so Caddy's
`handle_path /keeweb/*` prefix-strip resolves assets correctly. Live at
https://thederf.com/keeweb.

The original 1.x source is preserved under `_legacy/` for reference.
