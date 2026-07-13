import { defineStore } from 'pinia';
import { ref, shallowRef, computed, markRaw, triggerRef } from 'vue';
import { watchDebounced } from '@vueuse/core';
import { KdbxFile } from '@/domain/kdbx-file';
import { deriveList, type SearchOptions } from '@/domain/search';
import { getProvider } from '@/storage';
import { saveToHandle, saveDatabaseAs, supportsFileSystemAccess } from '@/storage/local';
import { createBackup, backupToStorage } from '@/storage/backup';
import { StorageConflictError, StorageNotFoundError } from '@/storage/errors';
import { auditEntries, type AuditIssue } from '@/domain/audit';
import { checkManyPwned } from '@/domain/hibp';
import { exportToHtml } from '@/domain/kdbx-to-html';
import type { CsvEntryData } from '@/domain/csv';
import { useSettingsStore } from '@/stores/settings';
import { useUiStore } from '@/stores/ui';
import { t } from '@/i18n';
import type {
  EntryVm,
  GroupVm,
  FileVm,
  MenuSelection,
  SortField,
  SortDir,
  OpenParams,
  NewFileParams
} from '@/types';

export interface FileTree {
  file: FileVm;
  tree: GroupVm;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const useVaultStore = defineStore('vault', () => {
  // KdbxFile instances are kept raw (kdbxweb objects don't need Vue deep
  // reactivity). `rev` is bumped after every mutation to invalidate computeds.
  const filesRef = shallowRef<KdbxFile[]>([]);
  const rev = ref(0);

  const selection = ref<MenuSelection>({ type: 'all' });
  const selectedEntryId = ref<string | null>(null);
  const search = ref<SearchOptions>({ text: '' });
  const sortField = ref<SortField>('title');
  const sortDir = ref<SortDir>('asc');
  const generatorOpen = ref(false);

  function bump(): void {
    rev.value++;
    triggerRef(filesRef);
  }

  function rawFiles(): KdbxFile[] {
    return filesRef.value;
  }

  function findFile(id: string): KdbxFile | undefined {
    return filesRef.value.find((f) => f.id === id);
  }

  // ---- derived view models -------------------------------------------------

  const files = computed<FileVm[]>(() => {
    void rev.value;
    return filesRef.value.map((f) => f.toVm());
  });

  const hasFiles = computed(() => filesRef.value.length > 0);

  const allEntries = computed<EntryVm[]>(() => {
    void rev.value;
    return filesRef.value.flatMap((f) => f.getAllEntries(true));
  });

  const groupTrees = computed<FileTree[]>(() => {
    void rev.value;
    return filesRef.value.map((f) => ({ file: f.toVm(), tree: f.getGroupTree() }));
  });

  const tags = computed<string[]>(() => {
    void rev.value;
    const set = new Set<string>();
    for (const f of filesRef.value) for (const t of f.getAllTags()) set.add(t);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  });

  const list = computed<EntryVm[]>(() =>
    deriveList({
      entries: allEntries.value,
      selection: selection.value,
      search: search.value,
      sortField: sortField.value,
      sortDir: sortDir.value
    })
  );

  const selectedEntry = computed<EntryVm | null>(() => {
    if (!selectedEntryId.value) return null;
    return allEntries.value.find((e) => e.id === selectedEntryId.value) ?? null;
  });

  // ---- file lifecycle ------------------------------------------------------

  function addFile(file: KdbxFile): void {
    filesRef.value = [...filesRef.value, markRaw(file)];
    bump();
    // Auto-select the file's root group.
    selection.value = { type: 'group', fileId: file.id, groupId: file.getGroupTree().id };
  }

  async function openFile(params: OpenParams): Promise<KdbxFile> {
    const file = await KdbxFile.open(params);
    addFile(file);
    return file;
  }

  async function createFile(params: NewFileParams): Promise<KdbxFile> {
    const file = await KdbxFile.create(params);
    addFile(file);
    return file;
  }

  function closeFile(id: string): void {
    const file = findFile(id);
    if (file) {
      // Drop breach-check results belonging to this file's entries.
      for (const entry of file.getAllEntries(true)) pwnedResults.value.delete(entry.id);
    }
    filesRef.value = filesRef.value.filter((f) => f.id !== id);
    if (selectedEntry.value?.fileId === id) selectedEntryId.value = null;
    selection.value = { type: 'all' };
    bump();
  }

  async function saveFile(id: string): Promise<ArrayBuffer | null> {
    const file = findFile(id);
    if (!file) return null;
    const data = await file.save();
    bump();
    return data;
  }

  // ---- per-file save/sync serialization -------------------------------------
  //
  // Save and sync mutate the shared Kdbx object and write to a single origin.
  // Running two operations for the same file concurrently (auto-save debounce +
  // interval sync + manual save) can interleave pull→merge→save and corrupt
  // data, so each file gets a promise chain and new operations queue behind the
  // one in flight.

  const fileOps = new Map<string, Promise<void>>();
  const syncsInFlight = new Map<string, Promise<boolean>>();

  function runExclusive<T>(fileId: string, op: () => Promise<T>): Promise<T> {
    const prev = fileOps.get(fileId) ?? Promise.resolve();
    const run = prev.then(op);
    // Track a never-rejecting tail so a failed op doesn't poison the chain.
    const tracked = run.then(
      () => undefined,
      () => undefined
    );
    fileOps.set(fileId, tracked);
    void tracked.then(() => {
      if (fileOps.get(fileId) === tracked) fileOps.delete(fileId);
    });
    return run;
  }

  /** Config object passed to storage providers that need credentials. */
  function providerConfig(storage: string): Record<string, string> {
    const settings = useSettingsStore();
    if (storage === 'webdav') {
      return { url: settings.webdav.url, user: settings.webdav.user, password: settings.webdav.password };
    }
    return {};
  }

  /**
   * Best-effort backups taken before overwriting a file: a rotating copy in
   * IndexedDB (when `backupEnabled`) and/or a timestamped copy written to the
   * file's own storage backend (when `backupStorage`), the way KeeWeb backed up
   * to WebDAV/Dropbox/Drive/OneDrive/local folders.
   */
  async function maybeBackup(file: KdbxFile, data: ArrayBuffer): Promise<void> {
    const settings = useSettingsStore();
    const now = Date.now();
    if (settings.backupEnabled) {
      try {
        await createBackup(file.id, data.slice(0), settings.backupCount, now);
      } catch {
        /* local backup is best-effort */
      }
    }
    if (settings.backupStorage) {
      const provider = getProvider(file.storage);
      if (provider?.save && file.path) {
        try {
          await backupToStorage({
            provider,
            config: providerConfig(file.storage),
            template: settings.backupStoragePath,
            name: file.name,
            data: data.slice(0),
            keep: settings.backupCount,
            now: new Date(now)
          });
        } catch (e) {
          useUiStore().notify(t('setFileBackupError'), {
            color: 'warning',
            description: errorMessage(e)
          });
        }
      }
    }
  }

  /**
   * Persist a file to its origin: through the matching storage provider
   * (WebDAV / Dropbox / Google Drive / OneDrive / local folder) when the file
   * has a remote path, write-back to a File System Access handle for opened
   * local files, or a download / Save-As fallback. Creates a rotating backup
   * first when enabled. Returns true on success; keeps changes locally on
   * failure.
   *
   * Serialized per file via {@link runExclusive}: a call made while another
   * save/sync for the same file is in flight queues behind it.
   */
  function persistFile(id: string): Promise<boolean> {
    return runExclusive(id, () => doPersistFile(id));
  }

  async function doPersistFile(id: string): Promise<boolean> {
    const file = findFile(id);
    if (!file) return false;
    const ui = useUiStore();

    // Snapshot the modification counter: `modified` is only cleared when no
    // further edits landed while the write was in flight.
    const modBefore = file.modCount;
    let data: ArrayBuffer;
    try {
      data = await file.save();
      bump();
    } catch (e) {
      ui.notify(t('setFileSaveError'), { color: 'error', description: errorMessage(e) });
      return false;
    }

    await maybeBackup(file, data);

    const provider = getProvider(file.storage);
    try {
      if (provider && provider.save && file.path) {
        if (provider.oauth && provider.isAuthorized && !provider.isAuthorized()) {
          await provider.authorize?.();
        }
        // Unconditional overwrite: this is the plain "save my copy now" path
        // (manual save / save-on-lock). `syncFile` is the conflict-safe route.
        const stat = await provider.save(file.path, data, providerConfig(file.storage));
        file.syncRev = stat.rev;
        file.lastSyncTime = Date.now();
        ui.notify(t('appSavedTo', provider.title), { color: 'success', description: file.name });
      } else if (file.fsHandle) {
        await saveToHandle(file.fsHandle, data);
        file.lastSyncTime = Date.now();
        ui.notify(t('appSaved'), { color: 'success', description: file.name });
      } else {
        const handle = await saveDatabaseAs(`${file.name}.kdbx`, data);
        if (handle) file.fsHandle = handle;
        ui.notify(supportsFileSystemAccess() ? t('appSaved') : t('appDownloaded'), {
          color: 'success',
          description: `${file.name}.kdbx`
        });
      }
      if (file.modCount === modBefore) file.modified = false;
      bump();
      return true;
    } catch (e) {
      // `modified` was never cleared, so the dirty state survives the failure.
      ui.notify(t('setFileSaveError'), {
        color: 'error',
        description: `${errorMessage(e)} — ${t('appChangesKeptLocally')}`
      });
      return false;
    }
  }

  /**
   * Sync a remote file: pull the current remote copy, merge it into the local
   * database (kdbxweb's KDBX three-way merge — the same UUID/timestamp/tombstone
   * merge KeePass and KeeWeb use, NOT a CRDT), then push the merged result back.
   * For files with no remote provider this is equivalent to `persistFile`.
   *
   * The push is conditional on the revision we merged against (optimistic
   * concurrency): if another device wrote during the pull→push window the
   * provider throws {@link StorageConflictError} and we re-pull, re-merge and
   * retry, so a concurrent write is merged in rather than overwritten. A missing
   * remote (never pushed yet) is created unconditionally.
   *
   * Serialized per file via {@link runExclusive}. A `syncFile` call made while
   * another sync for the same file is already in flight simply awaits the
   * in-flight one and returns its result instead of queuing a second sync.
   */
  function syncFile(id: string): Promise<boolean> {
    const inFlight = syncsInFlight.get(id);
    if (inFlight) return inFlight;
    const run = runExclusive(id, () => doSyncFile(id));
    syncsInFlight.set(id, run);
    const clear = (): void => {
      if (syncsInFlight.get(id) === run) syncsInFlight.delete(id);
    };
    run.then(clear, clear);
    return run;
  }

  async function doSyncFile(id: string): Promise<boolean> {
    const file = findFile(id);
    if (!file) return false;
    const ui = useUiStore();
    const provider = getProvider(file.storage);

    if (!provider || !provider.save || !file.path) {
      // Already inside this file's exclusive chain — run the persist body
      // directly instead of re-queueing (which would deadlock).
      return doPersistFile(id);
    }

    const MAX_ATTEMPTS = 4;
    try {
      if (provider.oauth && provider.isAuthorized && !provider.isAuthorized()) {
        await provider.authorize?.();
      }

      for (let attempt = 1; ; attempt++) {
        // Pull + merge the remote if it exists, remembering the revision we
        // merged against so the push can be made conditional on it.
        let baseRev: string | undefined;
        try {
          const remote = await provider.load(file.path, providerConfig(file.storage));
          await file.mergeRemote(remote.data);
          bump();
          baseRev = remote.stat.rev;
        } catch (e) {
          if (!(e instanceof StorageNotFoundError)) throw e;
          // Remote missing / first push — create it unconditionally.
          baseRev = undefined;
        }

        const modBefore = file.modCount;
        const data = await file.save();
        bump();

        try {
          const stat = await provider.save(file.path, data, providerConfig(file.storage), baseRev);
          file.syncRev = stat.rev;
          file.lastSyncTime = Date.now();
          if (file.modCount === modBefore) file.modified = false;
          bump();
          // Backup once per successful push — not per attempt, so a conflicted
          // sync doesn't spam backups for pushes that never landed.
          await maybeBackup(file, data);
          ui.notify(t('appSyncedWith', provider.title), { color: 'success', description: file.name });
          return true;
        } catch (e) {
          // Lost the optimistic-concurrency race: loop back to re-pull & merge.
          if (e instanceof StorageConflictError && attempt < MAX_ATTEMPTS) continue;
          throw e;
        }
      }
    } catch (e) {
      // `modified` was never cleared, so the dirty state survives the failure.
      ui.notify(t('setFileSyncError'), { color: 'error', description: errorMessage(e) });
      return false;
    }
  }

  // ---- selection & view ----------------------------------------------------

  function setSelection(sel: MenuSelection): void {
    selection.value = sel;
    selectedEntryId.value = null;
  }

  function selectEntry(id: string | null): void {
    selectedEntryId.value = id;
  }

  function setSearch(opts: Partial<SearchOptions>): void {
    search.value = { ...search.value, ...opts };
  }

  function setSort(field: SortField, dir?: SortDir): void {
    if (dir) {
      sortField.value = field;
      sortDir.value = dir;
    } else if (sortField.value === field) {
      sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
    } else {
      sortField.value = field;
      sortDir.value = 'asc';
    }
  }

  // ---- entry / group mutations --------------------------------------------

  function currentFileId(): string | undefined {
    if (selection.value.type === 'group') return selection.value.fileId;
    return filesRef.value[0]?.id;
  }

  function currentGroupId(): string | undefined {
    if (selection.value.type === 'group') return selection.value.groupId;
    return filesRef.value[0]?.getGroupTree().id;
  }

  function createEntry(): EntryVm | null {
    const file = findFile(currentFileId() ?? '');
    if (!file) return null;
    const entry = file.createEntry(currentGroupId());
    bump();
    const vm = file.entryToVm(entry);
    selectedEntryId.value = vm.id;
    return vm;
  }

  function createGroup(fileId: string, parentId: string | undefined, name: string): void {
    findFile(fileId)?.createGroup(parentId, name);
    bump();
  }

  function withFile<T>(fileId: string, fn: (f: KdbxFile) => T): T | undefined {
    const file = findFile(fileId);
    if (!file) return undefined;
    const result = fn(file);
    bump();
    return result;
  }

  function updateField(
    fileId: string,
    entryId: string,
    name: string,
    value: string,
    protect = false
  ): void {
    withFile(fileId, (f) => f.setEntryField(entryId, name, value, protect));
  }

  function renameField(fileId: string, entryId: string, oldName: string, newName: string): void {
    withFile(fileId, (f) => f.renameField(entryId, oldName, newName));
  }

  function removeField(fileId: string, entryId: string, name: string): void {
    withFile(fileId, (f) => f.removeField(entryId, name));
  }

  function setTags(fileId: string, entryId: string, tags: string[]): void {
    withFile(fileId, (f) => f.setEntryTags(entryId, tags));
  }

  function setColor(fileId: string, entryId: string, color: string | undefined): void {
    withFile(fileId, (f) => f.setEntryColor(entryId, color));
  }

  function setIcon(fileId: string, entryId: string, icon: number): void {
    withFile(fileId, (f) => f.setEntryIcon(entryId, icon));
  }

  function setExpiry(fileId: string, entryId: string, expires: number | undefined): void {
    withFile(fileId, (f) => f.setEntryExpiry(entryId, expires));
  }

  function deleteEntry(fileId: string, entryId: string): void {
    withFile(fileId, (f) => f.deleteEntry(entryId));
    if (selectedEntryId.value === entryId) selectedEntryId.value = null;
  }

  function cloneEntry(fileId: string, entryId: string): void {
    const file = findFile(fileId);
    if (!file) return;
    const copy = file.cloneEntry(entryId);
    bump();
    if (copy) selectedEntryId.value = copy.uuid.id;
  }

  function moveEntry(fileId: string, entryId: string, toGroupId: string): void {
    withFile(fileId, (f) => f.moveEntry(entryId, toGroupId));
  }

  async function addAttachment(
    fileId: string,
    entryId: string,
    name: string,
    data: ArrayBuffer
  ): Promise<void> {
    const file = findFile(fileId);
    if (!file) return;
    await file.addAttachment(entryId, name, data);
    bump();
  }

  function removeAttachment(fileId: string, entryId: string, name: string): void {
    withFile(fileId, (f) => f.removeAttachment(entryId, name));
  }

  function getAttachmentData(fileId: string, entryId: string, name: string): Uint8Array | undefined {
    return findFile(fileId)?.getAttachmentData(entryId, name);
  }

  function renameGroup(fileId: string, groupId: string, name: string): void {
    withFile(fileId, (f) => f.renameGroup(groupId, name));
  }

  function deleteGroup(fileId: string, groupId: string): void {
    withFile(fileId, (f) => f.deleteGroup(groupId));
  }

  function emptyTrash(fileId: string): void {
    withFile(fileId, (f) => f.emptyTrash());
  }

  // ---- references / auto-type / extra urls / tags / templates --------------

  function resolveReference(fileId: string, value: string): string {
    return findFile(fileId)?.resolveReferences(value) ?? value;
  }

  function setAutoType(
    fileId: string,
    entryId: string,
    config: { enabled?: boolean; obfuscation?: boolean; sequence?: string }
  ): void {
    withFile(fileId, (f) => f.setAutoType(entryId, config));
  }

  function getEffectiveAutoTypeSeq(fileId: string, entryId: string): string {
    return findFile(fileId)?.getEffectiveAutoTypeSeq(entryId) ?? '{USERNAME}{TAB}{PASSWORD}{ENTER}';
  }

  function setExtraUrls(fileId: string, entryId: string, urls: string[]): void {
    withFile(fileId, (f) => f.setExtraUrls(entryId, urls));
  }

  function renameTag(fileId: string, from: string, to: string): void {
    withFile(fileId, (f) => f.renameTag(from, to));
  }

  function deleteTag(fileId: string, tag: string): void {
    withFile(fileId, (f) => f.deleteTag(tag));
  }

  function restoreEntry(fileId: string, entryId: string): void {
    withFile(fileId, (f) => f.restoreEntry(entryId));
  }

  function getEntryTemplates(fileId: string) {
    return findFile(fileId)?.getEntryTemplates() ?? [];
  }

  function createFromTemplate(fileId: string, templateId: string): void {
    const file = findFile(fileId);
    if (!file) return;
    const entry = file.createFromTemplate(templateId, currentGroupId());
    bump();
    if (entry) selectedEntryId.value = entry.uuid.id;
  }

  // ---- import / export -----------------------------------------------------

  function importCsv(fileId: string, rows: CsvEntryData[]): number {
    const file = findFile(fileId);
    if (!file) return 0;
    const count = file.importEntries(rows, currentGroupId());
    bump();
    useUiStore().notify(t('appImportedEntries', count), { color: 'success' });
    return count;
  }

  async function importDatabase(
    fileId: string,
    data: ArrayBuffer,
    password: string | null,
    keyFile?: ArrayBuffer | null
  ): Promise<number> {
    const file = findFile(fileId);
    if (!file) return 0;
    const ui = useUiStore();
    try {
      const count = await file.importDatabase(data, password, keyFile);
      bump();
      ui.notify(t('appImportedEntries', count), { color: 'success' });
      return count;
    } catch (e) {
      ui.notify(t('appImportFailed'), { color: 'error', description: errorMessage(e) });
      return 0;
    }
  }

  async function exportXml(fileId: string): Promise<string | null> {
    return (await findFile(fileId)?.saveXml()) ?? null;
  }

  function exportHtml(fileId: string): string | null {
    const file = findFile(fileId);
    if (!file) return null;
    return exportToHtml(file.name, file.getAllEntries(false), Date.now());
  }

  function upgradeFormat(fileId: string): void {
    withFile(fileId, (f) => f.upgradeFormat());
  }

  // ---- audit ---------------------------------------------------------------

  // Auditing scans every entry (entropy + duplicate detection), so it is
  // decoupled from the hot `allEntries` computed: a debounced watcher
  // recomputes it at most twice a second instead of on every keystroke.
  // Exposed as a ref, which consumers read exactly like the old computed.
  const auditIssues = ref<AuditIssue[]>([]);
  watchDebounced(
    [allEntries, (): boolean => useSettingsStore().auditPasswords],
    ([entries, enabled]) => {
      auditIssues.value = enabled ? auditEntries(entries, { excludePins: true, checkAge: true }) : [];
    },
    { debounce: 500, immediate: true }
  );

  const pwnedResults = ref<Map<string, number>>(new Map());

  async function checkPwned(): Promise<void> {
    const ui = useUiStore();
    const items = allEntries.value
      .filter((e) => !e.inTrash && e.password)
      .map((e) => ({ id: e.id, password: e.password }));
    try {
      pwnedResults.value = await checkManyPwned(items);
      const n = pwnedResults.value.size;
      ui.notify(n ? t('auditPwnedFound', n) : t('auditPwnedNone'), {
        color: n ? 'warning' : 'success'
      });
    } catch (e) {
      ui.notify(t('auditPwnedCheckFailed'), { color: 'error', description: errorMessage(e) });
    }
  }

  // ---- file settings -------------------------------------------------------

  function setFileName(fileId: string, name: string): void {
    withFile(fileId, (f) => f.setName(name));
  }

  function setDefaultUser(fileId: string, user: string): void {
    withFile(fileId, (f) => f.setDefaultUser(user));
  }

  function setHistoryMaxItems(fileId: string, count: number): void {
    withFile(fileId, (f) => f.setHistoryMaxItems(count));
  }

  function setRecycleBinEnabled(fileId: string, enabled: boolean): void {
    withFile(fileId, (f) => f.setRecycleBinEnabled(enabled));
  }

  function setFormatVersion(fileId: string, version: 3 | 4, minor?: number): void {
    withFile(fileId, (f) => f.setFormatVersion(version, minor));
  }

  function setKdf(fileId: string, kdf: string): void {
    withFile(fileId, (f) => f.setKdf(kdf));
  }

  async function changePassword(fileId: string, password: string | null): Promise<void> {
    const file = findFile(fileId);
    if (!file) return;
    await file.setPassword(password);
    bump();
  }

  async function changeKeyFile(
    fileId: string,
    data: ArrayBuffer | null,
    name?: string
  ): Promise<void> {
    const file = findFile(fileId);
    if (!file) return;
    await file.setKeyFile(data, name);
    bump();
  }

  function revertHistory(fileId: string, entryId: string, index: number): void {
    withFile(fileId, (f) => f.revertHistory(entryId, index));
  }

  function deleteHistory(fileId: string, entryId: string, index: number): void {
    withFile(fileId, (f) => f.deleteHistory(entryId, index));
  }

  return {
    // state
    selection,
    selectedEntryId,
    search,
    sortField,
    sortDir,
    generatorOpen,
    // derived
    files,
    hasFiles,
    allEntries,
    groupTrees,
    tags,
    list,
    selectedEntry,
    // raw access (for services that need the KdbxFile)
    rawFiles,
    findFile,
    // lifecycle
    openFile,
    createFile,
    closeFile,
    saveFile,
    persistFile,
    syncFile,
    addFile,
    // view
    setSelection,
    selectEntry,
    setSearch,
    setSort,
    // mutations
    createEntry,
    createGroup,
    updateField,
    renameField,
    removeField,
    setTags,
    setColor,
    setIcon,
    setExpiry,
    deleteEntry,
    cloneEntry,
    moveEntry,
    addAttachment,
    removeAttachment,
    getAttachmentData,
    renameGroup,
    deleteGroup,
    emptyTrash,
    revertHistory,
    deleteHistory,
    // file settings
    setFileName,
    setDefaultUser,
    setHistoryMaxItems,
    setRecycleBinEnabled,
    setFormatVersion,
    upgradeFormat,
    setKdf,
    changePassword,
    changeKeyFile,
    // references / auto-type / extra urls / tags / templates
    resolveReference,
    setAutoType,
    getEffectiveAutoTypeSeq,
    setExtraUrls,
    renameTag,
    deleteTag,
    restoreEntry,
    getEntryTemplates,
    createFromTemplate,
    // import / export
    importCsv,
    importDatabase,
    exportXml,
    exportHtml,
    // audit
    auditIssues,
    pwnedResults,
    checkPwned
  };
});
