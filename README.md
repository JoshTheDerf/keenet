# KeeNet

KeeNet is a free, cross-platform password manager for KeePass (`.kdbx`) files. It's a ground-up TypeScript and Vue 3 rewrite of [KeeWeb](https://github.com/keeweb/keeweb), continued under new maintenance with its own domain and OAuth apps.

## Stack

- **Vue 3.5** (`<script setup lang="ts">`) with **Pinia** for state
- **Nuxt UI 4.9** (standalone Vue mode) and **Tailwind CSS v4**
- **Vite 6** for builds
- **kdbxweb** for KeePass crypto, **hash-wasm** for Argon2 (the KDBX4 KDF)
- **zxcvbn** for password strength, Web Crypto for TOTP/HOTP
- **Vitest** for unit tests, **vue-tsc** for type checking

## Scripts

```bash
npm ci              # install (always from the lockfile)
npm run dev         # Vite dev server
npm run build       # vue-tsc --noEmit && vite build, outputs to dist/
npm run build:web   # web build for the site: app in dist/app/, landing.html as dist/index.html
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

The kdbxweb `Kdbx` object is the single source of truth. The UI renders plain view-models projected by `KdbxFile`, re-derived after every mutation (see `CONTRACT.md`).

## Features

- **Databases:** open, create, demo. Master password and key file. KDBX 3.1, 4.0 and 4.1 (new files are 4.1) with format conversion and upgrade, plus Argon2d/Argon2id/AES KDF conversion.
- **Entries:** full CRUD, protected and custom fields, field references (`{REF:...}`), attachments, live TOTP/HOTP codes (plus QR scan), multiple URLs (KP2A), tags, colors, expiry, KeePass icons, history (revert/delete), clone, auto-type sequence editor, entry templates, trash and restore.
- **Views:** groups tree, tags (rename/delete), colors, trash, expired filter, text/case/regex/protected search, sorting, list and table modes, responsive mobile layout, markdown notes.
- **Tools:** command palette (Ctrl/Cmd+K) for actions and jumping to entries. Password generator with presets (including user presets and derive-from-password), character sets and entropy. Password audit (weak/duplicate/old) plus Have I Been Pwned (k-anonymity). 12 themes (auto light/dark), en/de/fr, keyboard shortcuts (Ctrl+K/F/N/S/L/G/B/C, Ctrl+,), auto-lock (idle, tab hidden, OS lock), and full keyboard navigation of the menu tree and entry list.
- **Storage and sync:** local file (File System Access), Local Folder (persistent dir handle), WebDAV, Dropbox / Google Drive / OneDrive (OAuth PKCE). Sync pulls, merges, then pushes. Auto-save and interval saves, rotating backups (IndexedDB), CSV import (column mapping), import/merge of another KDBX, XML and HTML export.
- **Desktop (Tauri):** native local file open/save, tray and close-to-tray, global shortcuts, native clipboard auto-clear, auto-type (OS keystroke injection via `enigo`), OS keychain secret storage.

## Security

- **Sanitized rendering:** markdown notes go through DOMPurify (allowlist profile, http(s)/mailto links only, forced `rel="noopener noreferrer"`). Vault content is treated as untrusted.
- **Content-Security-Policy:** strict CSP in the built `index.html` (`default-src 'self'`, no inline or eval scripts, `wasm-unsafe-eval` only for Argon2), relaxed automatically in dev. Tauri enforces it via `tauri.conf.json` (`app.security.csp`, adding `frame-ancestors 'none'`).
- **Tauri hardening:** system webview (no bundled Chromium) with a capability allowlist. Native features sit behind app-defined commands, and file read/write only works on paths granted through native dialogs (grants are persisted by the Rust backend only). OAuth pages open in a dedicated `oauth` window whose redirect navigation is intercepted and never loaded.
- **OAuth:** dependency-free PKCE (S256) as public clients, so no client secrets in the bundle. `state` is validated on web, desktop and mobile.
- **Secret storage:** OAuth tokens and the WebDAV password go in the OS keychain (the `keyring` crate on desktop, Keystore/Keychain on mobile), never plaintext files. On the web they stay in localStorage since there's no keychain, with the strict CSP and XSS hardening as the mitigation. Legacy plaintext values are migrated and scrubbed on first run. On a headless Linux box with no Secret Service, desktop secrets fall back to a base64-obfuscated file (not encryption, it just matches the old desktop fallback).
- **HIBP:** k-anonymity (only a 5-character SHA-1 prefix leaves the device), with response padding.
- **Supply chain:** JS dependencies pinned to exact versions (`save-exact`), lockfile installs via `npm ci`, an `npm run audit` script, no postinstall scripts and no network access in build scripts. The Rust crate pins its dependencies via `Cargo.lock`.
- Backups and the offline cache only store ciphertext. The master password is never persisted.

Known upstream advisories (tracked, not fixable here without downgrades): `kdbxweb`'s bundled `@xmldom/xmldom`, and a dev-only esbuild advisory.

Out of scope on purpose: the KeeWeb plugin system and the browser extension native-messaging connector (a separate companion app). Keystroke injection is limited under Wayland, so use an X11 session for auto-type on Linux.

Not ported yet from the old Electron shell: locking the vault on OS screen lock or suspend (Tauri has no built-in power monitor). The `lock` event already reaches the renderer, it just needs a platform power-event source. That's a tracked follow-up.

## Desktop build (Tauri)

You'll need the Rust toolchain and the platform webview dev libraries. On Ubuntu that's `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libsoup-3.0-dev`, `librsvg2-dev`, `libayatana-appindicator3-dev`, `libxdo-dev` and `pkg-config`.

```bash
npm run desktop:dev      # Tauri dev: launches the Rust shell against Vite HMR
npm run desktop:build    # build web + package (deb/AppImage/nsis/dmg)
npm run tauri -- icon public/icons/icon-512.png   # (re)generate platform icons,
                                                  # incl. macOS .icns / Win .ico
```

## PWA

The web build is an installable PWA that works offline (vite-plugin-pwa / Workbox), with a manifest, maskable icons and an auto-updating service worker that precaches the app shell. External calls (HIBP, cloud providers, OAuth) always hit the network. Install it from the browser's "Install app" prompt and it runs standalone. The service worker is skipped in the Tauri and native mobile shells, since they load bundled assets.

## Mobile build (Capacitor)

The Android and iOS apps wrap the same build in a WebView with a native bridge: local file storage (`@capacitor/filesystem`), native clipboard with auto-clear, biometric unlock on resume (`capacitor-native-biometric`), status bar, Android back button and haptics. Auto-type handles the same sequences, but the mobile sandbox can't type into other apps, so you'll need to copy instead.

```bash
npm run cap:add:android   # scaffold the native android/ project (done once)
npm run cap:android       # build web + sync + open in Android Studio
npm run cap:ios           # (on macOS) build web + sync + open in Xcode
npm run cap:sync          # rebuild web + copy assets/plugins into native projects
```

Building the APK/IPA needs the platform SDKs (Android Studio and a JDK, or Xcode and CocoaPods on macOS). The `android/` project is generated and synced.

## Releases and CI

`ci.yml` checks every push and PR (typecheck, lint, test, web build, audit). `release-desktop.yml` builds the Tauri app for Linux, macOS and Windows, and `release-mobile.yml` builds the Android and iOS apps (native projects are regenerated in CI). Both release workflows run on a `v*` tag or manual dispatch, and builds stay unsigned until you add signing secrets. [docs/RELEASING.md](docs/RELEASING.md) covers cutting a release and setting up code signing (Apple Developer, Android keystore, Windows cert).

## Deployment

`npm run build:web` output is served from `dist/` as static assets on Cloudflare Workers (`wrangler.jsonc`).

`npm run build` output can also be served as a static SPA at `/keeweb` behind Caddy (see `../compose`). It uses a relative base (`base: './'`), so Caddy's `handle_path /keeweb/*` prefix strip resolves assets correctly. Live at https://thederf.com/keeweb.

The original 1.x source is kept under `_legacy/` for reference.
