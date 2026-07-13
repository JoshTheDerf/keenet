# KeeWeb Vue 3 rebuild — component & store contract

This file is the source of truth for how UI components integrate. Follow it exactly.

## Stack
- Vue 3.5 `<script setup lang="ts">` + Nuxt UI 4.9 (standalone Vue mode, components are **auto-imported** — `UButton`, `UInput`, `UModal`, `UCard`, `UBadge`, `UIcon`, `USelectMenu`, `UPopover`, `UTooltip`, `UCheckbox`, `USwitch`, `UTabs`, `UTextarea`, `USlider`, `UAlert`, `UKbd`, `UDropdownMenu`, `UButtonGroup`, `UFieldGroup`, etc. — do NOT import them).
- Icons: Lucide via `i-lucide-<name>` string passed to `:icon` / `<UIcon name="i-lucide-...">`.
- Pinia stores in `src/stores`. i18n via `import { t } from '@/i18n'` (function) and `useI18n()`.
- Path alias `@/` → `src/`.
- Tailwind v4 utility classes. Nuxt UI color aliases: `primary`, `neutral`, `error`, `warning`, `success`, `info`.

## Stores (import from `@/stores/...`)

### `useVaultStore()` — `@/stores/vault`
State refs: `selection`, `selectedEntryId`, `search`, `sortField`, `sortDir`, `generatorOpen`.
Derived (computed, read `.value` in script / directly in template):
- `files: FileVm[]`, `hasFiles: boolean`
- `allEntries: EntryVm[]`, `list: EntryVm[]` (already filtered+sorted for current selection/search)
- `groupTrees: { file: FileVm; tree: GroupVm }[]`
- `tags: string[]`
- `selectedEntry: EntryVm | null`
Actions:
- `openFile(params)`, `createFile(params)`, `closeFile(id)`, `saveFile(id)` (returns ArrayBuffer)
- `setSelection(sel: MenuSelection)`, `selectEntry(id|null)`, `setSearch(partial)`, `setSort(field, dir?)`
- `createEntry()` → EntryVm|null (creates in current group, selects it)
- `createGroup(fileId, parentId|undefined, name)`
- `updateField(fileId, entryId, name, value, protect?)` — name is `Title|UserName|Password|URL|Notes` or custom field name
- `renameField/removeField(fileId, entryId, ...)`, `setTags(fileId, entryId, string[])`
- `setColor(fileId, entryId, color|undefined)` (color = named: red/orange/yellow/green/blue/violet)
- `setIcon(fileId, entryId, iconIndex)`, `setExpiry(fileId, entryId, ms|undefined)`
- `deleteEntry`, `cloneEntry`, `moveEntry(fileId, entryId, toGroupId)`
- `addAttachment(fileId, entryId, name, ArrayBuffer)` (async), `removeAttachment`, `getAttachmentData(...)→Uint8Array|undefined`
- `renameGroup`, `deleteGroup`, `emptyTrash(fileId)`
- `revertHistory(fileId, entryId, index)`, `deleteHistory(...)`

### `useSettingsStore()` — `@/stores/settings`
Refs (auto-persisted to localStorage): `theme`, `autoSwitchTheme`, `locale`, `fontSize (0|1|2)`, `tableView`, `expandGroups`, `colorfulIcons`, `useMarkdown`, `autoSave`, `clipboardSeconds`, `idleMinutes`, `lockOnCopy`, `lockOnMinimize`, `auditPasswords`, `generatorHidePassword`, `generatorPresets: GeneratorPreset[]`, `webdav: {url,user,password}` (password is hydrated from / persisted to the secret store, never the localStorage blob), `rememberedFiles`.
Actions: `rememberFile(file)`.
Themes: `ThemeName = 'dark'|'light'|'sd'|'sl'|'fb'|'bl'|'db'|'lb'|'te'|'lt'|'hc'|'dc'`.

### `useUiStore()` — `@/stores/ui`
`screen: 'open'|'app'|'settings'`, `settingsPage`, `menuCollapsed`, `toasts`.
Actions: `showScreen(s)`, `openSettings(page?)`, `notify(title, {description?, color?})`, `dismiss(id)`.

## Types (`@/types`)
`EntryVm` fields: `id, fileId, groupId, title, username, password, passwordProtected, url, notes, fields: {name,value,protected}[], tags[], icon, customIcon?, fgColor?, bgColor?, color?, attachments: {name,size}[], otp?, created, updated, expires?, expired, historyLength, inTrash, groupPath[]`.
`GroupVm`: `id, fileId, name, icon, parentId?, entryCount, totalEntryCount, expanded, isRecycleBin, isRoot, children: GroupVm[]`.
`FileVm`: `id, name, modified, keyFileName?, storage, path?, entryCount, formatVersion, kdf, readOnly`.
`MenuSelection` (discriminated union `type`): `{type:'all'} | {type:'group',fileId,groupId} | {type:'trash',fileId?} | {type:'tag',tag} | {type:'color',color} | {type:'expired'}`.
`NAMED_COLORS`, `COLOR_HEX`.

## Domain helpers
- `@/domain/generator`: `BUILTIN_PRESETS`, `generatePassword(preset)`, `resolveDefaultPreset(userPresets)` (use this to pick the preset for quick-generate actions), `buildCharPool`, `presetPoolSize`, `estimateEntropyBits(len,pool)`, types `GeneratorPreset`, `GeneratorRanges`, `CHAR_RANGES`.
- `@/domain/strength`: `estimateStrength(pw, userInputs?)→Promise<PasswordStrength>`, `quickStrength(pw)`, type `PasswordStrength {level,label,value(0..1),color}`.
- `@/domain/otp`: `parseOtpUri(uri)→OtpParams`, `computeOtp(params, atMs?)→Promise<string>`, `totpTimeLeft(period, atMs?)`.
- `@/const/icons`: `iconClass(index)→'i-lucide-...'`, `iconName(index)`, `KEEPASS_ICON_TO_LUCIDE`, `DEFAULT_ENTRY_ICON`.
- `@/const/colors`: `ALL_COLORS`, `COLOR_DISPLAY` (named→css hex).
- `@/storage/local`: `pickDatabaseFile()`, `pickFileViaInput(accept)`, `downloadData(name,data,mime?)`, `saveDatabaseAs(name,data)`.

## Shared components (in `src/components/shared`, provided)
- `EntryIcon.vue` — props `{ icon: number; color?: string; size?: string }`.
- `PasswordStrengthBar.vue` — props `{ password: string; userInputs?: string[] }`.
- `ColorDot.vue` — props `{ color?: string; size?: string }`.

## Clipboard
Use `@/composables/useClipboard` → `copy(text, label?, opts?)` (auto-clears after `clipboardSeconds`, shows toast). Pass `{ sensitive: true }` when copying passwords/protected values — it honors the `lockOnCopy` setting.

## Locking & overlays
- `@/composables/useLock`: `useLock()` (idle / minimize / OS-lock watchers) and `lockNow()` — the ONLY correct way to lock: best-effort persists modified files, closes all, returns to open screen. Never close files directly to "lock".
- `@/composables/useOverlays`: shared refs `commandPaletteOpen`, `auditOpen`, `importOpen`, `toggleCommandPalette()` — drive the command palette (Ctrl/Cmd+K), audit panel, and import dialog from anywhere.

## Storage & sync (added)

`useVaultStore()` additions:
- `saveFile(id)` → serialize only (returns ArrayBuffer). Does NOT clear the modified flag. Prefer the two below.
- `persistFile(id)` → save to origin (provider by `file.storage`+path / FS handle / download), creates a rotating backup when enabled, toasts result. Returns boolean. Clears `modified` only after a successful origin write.
- `syncFile(id)` → for remote files: pull → **merge** (kdbxweb CRDT) → push; local files fall back to persist. Use this for the main "Save" action.
- Both are serialized per file by an internal mutex — concurrent calls queue (persist) or coalesce (sync); never bypass them by calling `KdbxFile.save()` directly.
- `auditIssues` is a debounced ref (recomputes ~500ms after changes), not a hot computed.
- File-settings actions: `setFileName(id,name)`, `setDefaultUser(id,user)`, `setHistoryMaxItems(id,n)`, `setRecycleBinEnabled(id,bool)`, `setFormatVersion(id, 3|4)`, `setKdf(id, 'AES'|'Argon2d'|'Argon2id')`, `changePassword(id, string|null)` (async), `changeKeyFile(id, ArrayBuffer|null, name?)` (async).

`useSettingsStore()` additions: `autoSaveInterval` (min, 0=off), `storageEnabled: Record<string,bool>`, `cloudKeys: {dropboxAppKey,gdriveClientId,onedriveClientId}`, `backupEnabled`, `backupCount`, `syncOnSave`.

Storage registry — `@/storage`:
- `PROVIDERS: StorageProvider[]`, `getProvider(type)`.
- Each `StorageProvider`: `type,title,icon,oauth?,needsConfig,configFields?`, `load(path,config?)`, `save(path,data,config?,rev?)`, `stat?`, `list?(dir,config?)`, and for oauth: `isAuthorized()`, `authorize()`, `logout()`.
- OAuth providers are built on `@/storage/oauth-provider` → `createOAuthProviderAuth({...})` (shared configure/apiFetch/authHeader/isAuthorized/logout). New OAuth providers must use it; they are PKCE **public clients** — never add a client_secret to browser code. `authorize()` returns `{code, state}` and state is validated centrally in `oauthFlow`.
- Providers: `fsaccess` (Local Folder — File System Access, persistent dir handle), `webdav`, `dropbox`, `gdrive`, `onedrive`.
- `@/storage/filesystem`: `fileSystemProvider`, `chooseFolder()`, `hasFolder()`, `supportsFileSystemAccess()`.
- `@/storage/backup`: `createBackup`, `listBackups(fileId)→BackupEntry[]`, `restoreBackup(key)→ArrayBuffer`, `removeBackup(key)`.
- WebDAV load config shape: `{url,user,password}`.
- `@/storage/secret-store`: pluggable secret storage (`secretStore` facade: async `get/set/remove`, sync `getCached`, `preload`; `registerSecretBackend` for platform shells). OAuth token sets and the WebDAV password live here — OS-keychain-backed on desktop (Tauri `keyring` crate) and mobile (Keystore/Keychain via capacitor-native-biometric), `keeweb-secret:`-prefixed localStorage on web. `main.ts` awaits `secretStore.preload()` before mount, so cached reads (e.g. `settings.webdav.password`, `isTokenValid`) are hydrated by first render. Never persist a secret anywhere else.

## Ported features API (added)

**EntryVm additions**: `extraUrls: string[]`, `autoType: { enabled, obfuscation, sequence?, items: {window,sequence}[] }`, `hasReferences: boolean`.
**FileVm additions**: `versionLabel` ("4.1"), `isLatestFormat`, `defaultUser`, `historyMaxItems`, `recycleBinEnabled`.

`useVaultStore()` additions:
- `resolveReference(fileId, value)→string` — expand `{REF:...}`.
- `setAutoType(fileId, entryId, {enabled?,obfuscation?,sequence?})`, `getEffectiveAutoTypeSeq(fileId, entryId)→string`.
- `setExtraUrls(fileId, entryId, string[])`.
- `renameTag(fileId, from, to)`, `deleteTag(fileId, tag)`.
- `restoreEntry(fileId, entryId)` — move a trashed entry back.
- `getEntryTemplates(fileId)→{id,title,icon}[]`, `createFromTemplate(fileId, templateId)` (creates + selects).
- `importCsv(fileId, CsvEntryData[])→number`, `importDatabase(fileId, ArrayBuffer, password, keyFile?)→Promise<number>`.
- `exportXml(fileId)→Promise<string|null>`, `exportHtml(fileId)→string|null`.
- `setFormatVersion(fileId, 3|4, minor?)`, `upgradeFormat(fileId)` (→ KDBX 4.1 + Argon2id).
- `auditIssues` (computed `AuditIssue[] {entryId,fileId,kind:'weak'|'duplicate'|'pwned'|'old',detail}`), `pwnedResults` (ref `Map<entryId,count>`), `checkPwned()` (async, HIBP).

Domain modules:
- `@/domain/audit`: `auditEntries(entries, {excludePins?,checkAge?,entropyThreshold?})`, `passwordEntropy(pw)`, `isPin(pw)`, type `AuditIssue`.
- `@/domain/hibp`: `checkPwned(pw)→Promise<number>`, `checkManyPwned(items)`.
- `@/domain/csv`: `parseCsv(text)→string[][]`, `guessMapping(header)→CsvMapping`, `rowsToEntries(rows, mapping, hasHeader)→CsvEntryData[]`, types `CsvMapping`, `CsvEntryData`, `StdField`.
- `@/domain/auto-type`: `parseSequence(seq, ctx)`, `runAutoType(seq, ctx)`, `sequenceToText(seq, ctx)`, `DEFAULT_SEQUENCE`, `registerAutoTypeEmitter(e)`, `hasNativeEmitter()`, types `AutoTypeContext`, `AutoTypeOp`.
- `@/domain/markdown`: `renderMarkdown(text)→string` (sanitized HTML), `looksLikeMarkdown(text)`.
- `@/domain/references`: `resolveFieldReferences`, `hasFieldReferences`.
- `@/domain/kdbx-to-html`: `exportToHtml(fileName, entries, epochMs)→string`.

**Desktop bridge**: when running under the Tauri desktop shell, `window.keeweb` (typed in `@/types/desktop.d.ts`) is installed by `@/desktop/tauri-bridge` (backed by Rust commands in `src-tauri/`). Check `isDesktop()` from `@/composables/useDesktop`. Native file ops, tray, auto-type go through it.

## Conventions
- All components `<script setup lang="ts">`, fully typed, no `any`. `npm run lint` (eslint flat config) must pass.
- Emit typed events via `defineEmits<{ eventName: [argType] }>()`.
- Keep component-local state minimal; read/write through stores.
- **All** user-facing strings go through `t('key')`; new keys must be added to en-us, de-de, AND fr-fr (identical key sets — CI-checked by tests).
- Never use `window.prompt`/`confirm`/`alert` — use `TextPromptModal.vue` (shared) or a UModal confirm; destructive actions (permanent delete, delete group, empty trash, close/lock with unsaved changes) require confirmation.
- Icon-only buttons need both `UTooltip` (with `kbds` hint if a shortcut exists) and `aria-label`.

## Security invariants (do not regress)
- Markdown/HTML from vault data is sanitized with **DOMPurify** (`@/domain/markdown`) — never render vault-derived HTML any other way; never add `v-html` on unsanitized content.
- A strict CSP ships in `index.html` (relaxed automatically in dev by a vite plugin) and is enforced again in Electron via `onHeadersReceived`.
- Electron renderer: `sandbox: true`, `contextIsolation: true`; `file:read`/`file:write` IPC only accept main-process-granted paths (dialog-derived). Never widen the preload surface without validation in main.
- HIBP checks send only the 5-char SHA-1 prefix (k-anonymity). Backups/cache store ciphertext only. Master password is never persisted.
- Secrets (OAuth tokens, WebDAV password) go through `@/storage/secret-store` only — OS keychain on desktop/mobile, CSP-mitigated localStorage on web. Never write them to plain localStorage or into the `keeweb-settings` blob (the settings store deliberately excludes `webdav.password` from serialization).
- Dependencies are pinned exactly (`save-exact` in .npmrc); install with `npm ci`; run `npm run audit` before releases.
