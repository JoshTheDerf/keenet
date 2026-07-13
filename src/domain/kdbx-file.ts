/**
 * KdbxFile — the app's wrapper around a kdbxweb `Kdbx` database.
 *
 * The kdbx object is the single source of truth. All mutations go through this
 * class; the UI renders plain view-models produced by the `*ToVm` mappers and
 * re-derives them (via the Pinia store) after each mutation.
 */
import {
  Kdbx,
  KdbxEntry,
  KdbxGroup,
  KdbxUuid,
  Credentials,
  ProtectedValue,
  ByteUtils,
  Consts
} from 'kdbxweb';
import type { KdbxBinary, KdbxBinaryWithHash } from 'kdbxweb';
import type {
  EntryVm,
  GroupVm,
  FileVm,
  FieldVm,
  AttachmentVm,
  NewFileParams,
  OpenParams,
  StorageType
} from '@/types';
import { nearestNamedColor } from '@/const/colors';
import { hasFieldReferences, resolveFieldReferences, type RefEntry } from '@/domain/references';

export const BUILT_IN_FIELDS = new Set([
  'Title',
  'Password',
  'UserName',
  'URL',
  'Notes',
  'otp',
  'TOTP Seed',
  'TOTP Settings',
  '_etm_template_uuid'
]);

const STD = {
  title: 'Title',
  username: 'UserName',
  password: 'Password',
  url: 'URL',
  notes: 'Notes',
  otp: 'otp'
} as const;

export function fieldToString(value: string | ProtectedValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return value.getText();
}

function isProtected(value: string | ProtectedValue | undefined): boolean {
  return value instanceof ProtectedValue;
}

function uuidStr(uuid: KdbxUuid | undefined): string {
  return uuid ? uuid.id : '';
}

function binarySize(bin: KdbxBinary | KdbxBinaryWithHash): number {
  const value = 'value' in bin ? bin.value : bin;
  if (value instanceof ProtectedValue) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  return 0;
}

let fileSeq = 0;

export class KdbxFile {
  readonly id: string;
  db: Kdbx;
  name: string;
  storage: StorageType;
  path?: string;
  keyFileName?: string;
  modified = false;
  /**
   * Monotonic counter bumped on every modification. Lets the store clear
   * `modified` after a successful write only if no further edits happened
   * while the write was in flight.
   */
  modCount = 0;
  readOnly = false;
  /** File System Access handle for saving back to a local file in place. */
  fsHandle?: FileSystemFileHandle;
  /** Last known storage revision (etag/rev) for change detection during sync. */
  syncRev?: string;
  /** Epoch ms of the last successful sync/save to origin. */
  lastSyncTime?: number;

  private entryIndex = new Map<string, KdbxEntry>();
  private groupIndex = new Map<string, KdbxGroup>();

  /**
   * Bumped whenever entry-VM state derived from OUTSIDE the entry object may
   * have changed: moves, group renames/deletes, trash operations, recycle-bin
   * toggling, merges, imports. Every operation that calls {@link reindex}
   * bumps it (plus `moveEntry`/`renameGroup`, which don't reindex). Part of
   * the entry-VM cache stamp — see {@link entryVmStamp}.
   */
  private structuralRev = 0;
  /** Per-entry VM cache, invalidated via {@link entryVmStamp}. */
  private vmCache = new WeakMap<KdbxEntry, { stamp: string; vm: EntryVm }>();

  constructor(db: Kdbx, name: string, storage: StorageType = 'file') {
    this.id = `f${++fileSeq}`;
    this.db = db;
    this.name = name;
    this.storage = storage;
    this.reindex();
  }

  // ---- lifecycle -----------------------------------------------------------

  static async open(params: OpenParams): Promise<KdbxFile> {
    const credentials = new Credentials(
      params.password ? ProtectedValue.fromString(params.password) : null,
      params.keyFileData ?? null
    );
    await credentials.ready;
    const db = await Kdbx.load(params.fileData, credentials);
    const file = new KdbxFile(db, params.name, params.storage ?? 'file');
    file.keyFileName = params.keyFileName;
    file.path = params.path;
    file.fsHandle = params.fsHandle;
    return file;
  }

  static async create(params: NewFileParams): Promise<KdbxFile> {
    const credentials = new Credentials(
      params.password ? ProtectedValue.fromString(params.password) : null,
      params.keyFileData ?? null
    );
    await credentials.ready;
    const db = Kdbx.create(credentials, params.name);
    db.setVersion(4);
    db.header.versionMinor = 1; // create as the latest format, KDBX 4.1
    db.setKdf(Consts.KdfId.Argon2d);
    db.createDefaultGroup();
    db.createRecycleBin();
    const file = new KdbxFile(db, params.name, 'file');
    file.keyFileName = params.keyFileName;
    file.modified = true;
    // Seed a couple of sample entries for a new database.
    const root = db.getDefaultGroup();
    const sample = db.createEntry(root);
    sample.fields.set('Title', 'Sample Entry');
    sample.fields.set('UserName', 'you@example.com');
    sample.fields.set('Password', ProtectedValue.fromString('changeme'));
    sample.fields.set('URL', 'https://keeweb.info');
    file.reindex();
    return file;
  }

  /**
   * Serialize the database. Does NOT touch the `modified` flag: serializing is
   * also used for exports, so only the vault store clears `modified` — after a
   * successful write to the file's origin (persist/sync).
   */
  async save(): Promise<ArrayBuffer> {
    this.db.cleanup({ historyRules: true, customIcons: true, binaries: true });
    return this.db.save();
  }

  async saveXml(): Promise<string> {
    return this.db.saveXml(true);
  }

  async setPassword(password: string | null): Promise<void> {
    await this.db.credentials.setPassword(password ? ProtectedValue.fromString(password) : null);
    this.markModified();
  }

  async setKeyFile(data: ArrayBuffer | null, name?: string): Promise<void> {
    await this.db.credentials.setKeyFile(data);
    this.keyFileName = data ? name : undefined;
    this.markModified();
  }

  // ---- indexing ------------------------------------------------------------

  reindex(): void {
    // Reindexing implies a structural change (delete/trash/merge/import/…):
    // cached entry VMs may hold stale groupPath/inTrash state.
    this.structuralRev++;
    this.entryIndex.clear();
    this.groupIndex.clear();
    for (const group of this.allGroups()) {
      this.groupIndex.set(uuidStr(group.uuid), group);
      for (const entry of group.entries) {
        this.entryIndex.set(uuidStr(entry.uuid), entry);
      }
    }
  }

  private *allGroups(): IterableIterator<KdbxGroup> {
    const root = this.db.getDefaultGroup();
    yield root;
    yield* root.allGroups();
  }

  getEntry(id: string): KdbxEntry | undefined {
    return this.entryIndex.get(id);
  }

  getGroup(id: string): KdbxGroup | undefined {
    return this.groupIndex.get(id);
  }

  get recycleBinUuid(): string | undefined {
    const uuid = this.db.meta.recycleBinUuid;
    return uuid && !uuid.empty ? uuid.id : undefined;
  }

  private markModified(): void {
    this.modified = true;
    this.modCount++;
  }

  private isInTrash(entry: KdbxEntry): boolean {
    const trashId = this.recycleBinUuid;
    if (!trashId) return false;
    let g: KdbxGroup | undefined = entry.parentGroup;
    while (g) {
      if (uuidStr(g.uuid) === trashId) return true;
      g = g.parentGroup;
    }
    return false;
  }

  // ---- mutations -----------------------------------------------------------

  createEntry(groupId?: string): KdbxEntry {
    const group = groupId ? this.getGroup(groupId) : this.db.getDefaultGroup();
    const target = group ?? this.db.getDefaultGroup();
    const entry = this.db.createEntry(target);
    entry.fields.set('Title', '');
    entry.fields.set('UserName', this.db.meta.defaultUser ?? '');
    entry.fields.set('Password', ProtectedValue.fromString(''));
    entry.fields.set('URL', '');
    entry.fields.set('Notes', '');
    this.entryIndex.set(uuidStr(entry.uuid), entry);
    this.markModified();
    return entry;
  }

  /** Bulk-create entries from field lists (used by CSV import). */
  importEntries(
    rows: { fields: { name: string; value: string; protected: boolean }[] }[],
    groupId?: string
  ): number {
    const group = groupId ? this.getGroup(groupId) : this.db.getDefaultGroup();
    const target = group ?? this.db.getDefaultGroup();
    let count = 0;
    for (const row of rows) {
      if (!row.fields.some((f) => f.value)) continue;
      const entry = this.db.createEntry(target);
      for (const field of row.fields) {
        entry.fields.set(field.name, field.protected ? ProtectedValue.fromString(field.value) : field.value);
      }
      this.entryIndex.set(uuidStr(entry.uuid), entry);
      count++;
    }
    this.markModified();
    return count;
  }

  createGroup(parentId: string | undefined, name: string): KdbxGroup {
    const parent = parentId ? this.getGroup(parentId) : this.db.getDefaultGroup();
    const group = this.db.createGroup(parent ?? this.db.getDefaultGroup(), name);
    this.groupIndex.set(uuidStr(group.uuid), group);
    this.markModified();
    return group;
  }

  /** Update a standard or custom field. Empty updated timestamp is bumped. */
  setEntryField(id: string, name: string, value: string, protect = false): void {
    const entry = this.getEntry(id);
    if (!entry) return;
    entry.pushHistory();
    if (protect) {
      entry.fields.set(name, ProtectedValue.fromString(value));
    } else {
      entry.fields.set(name, value);
    }
    entry.times.update();
    this.markModified();
  }

  renameField(id: string, oldName: string, newName: string): void {
    const entry = this.getEntry(id);
    if (!entry || oldName === newName) return;
    entry.pushHistory();
    const value = entry.fields.get(oldName);
    if (value !== undefined) {
      entry.fields.delete(oldName);
      entry.fields.set(newName, value);
    }
    entry.times.update();
    this.markModified();
  }

  removeField(id: string, name: string): void {
    const entry = this.getEntry(id);
    if (!entry) return;
    entry.pushHistory();
    entry.fields.delete(name);
    entry.times.update();
    this.markModified();
  }

  setEntryTags(id: string, tags: string[]): void {
    const entry = this.getEntry(id);
    if (!entry) return;
    entry.pushHistory();
    entry.tags = tags;
    entry.times.update();
    this.markModified();
  }

  setEntryColor(id: string, color: string | undefined): void {
    const entry = this.getEntry(id);
    if (!entry) return;
    entry.pushHistory();
    if (color) {
      const bg: Record<string, string> = {
        yellow: 'ffff88',
        green: '88ff88',
        red: 'ff8888',
        orange: 'ffcc88',
        blue: '8888ff',
        violet: 'ff88ff'
      };
      entry.bgColor = '#' + (bg[color] ?? 'ffffff');
    } else {
      entry.bgColor = undefined;
    }
    entry.times.update();
    this.markModified();
  }

  setEntryIcon(id: string, icon: number): void {
    const entry = this.getEntry(id);
    if (!entry) return;
    entry.pushHistory();
    entry.icon = icon;
    entry.times.update();
    this.markModified();
  }

  setEntryExpiry(id: string, expires: number | undefined): void {
    const entry = this.getEntry(id);
    if (!entry) return;
    entry.pushHistory();
    if (expires) {
      entry.times.expires = true;
      entry.times.expiryTime = new Date(expires);
    } else {
      entry.times.expires = false;
      entry.times.expiryTime = undefined;
    }
    entry.times.update();
    this.markModified();
  }

  async addAttachment(id: string, name: string, data: ArrayBuffer): Promise<void> {
    const entry = this.getEntry(id);
    if (!entry) return;
    entry.pushHistory();
    const binary = await this.db.createBinary(data);
    entry.binaries.set(name, binary);
    entry.times.update();
    this.markModified();
  }

  removeAttachment(id: string, name: string): void {
    const entry = this.getEntry(id);
    if (!entry) return;
    entry.pushHistory();
    entry.binaries.delete(name);
    entry.times.update();
    this.markModified();
  }

  getAttachmentData(id: string, name: string): Uint8Array | undefined {
    const entry = this.getEntry(id);
    const bin = entry?.binaries.get(name);
    if (!bin) return undefined;
    const value = 'value' in bin ? bin.value : bin;
    if (value instanceof ProtectedValue) return value.getBinary();
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return undefined;
  }

  moveEntry(id: string, toGroupId: string): void {
    const entry = this.getEntry(id);
    const group = this.getGroup(toGroupId);
    if (!entry || !group) return;
    this.db.move(entry, group);
    // kdbxweb's move updates locationChanged, not lastModTime — invalidate
    // cached VMs (groupId/groupPath/inTrash) via the structural counter.
    this.structuralRev++;
    this.markModified();
  }

  deleteEntry(id: string): void {
    const entry = this.getEntry(id);
    if (!entry) return;
    this.db.remove(entry);
    this.entryIndex.delete(id);
    this.reindex();
    this.markModified();
  }

  deleteGroup(id: string): void {
    const group = this.getGroup(id);
    if (!group || uuidStr(group.uuid) === uuidStr(this.db.getDefaultGroup().uuid)) return;
    this.db.remove(group);
    this.reindex();
    this.markModified();
  }

  renameGroup(id: string, name: string): void {
    const group = this.getGroup(id);
    if (!group) return;
    group.name = name;
    group.times.update();
    // Group names appear in entry VMs (groupPath) — invalidate cached VMs.
    this.structuralRev++;
    this.markModified();
  }

  emptyTrash(): void {
    const trashId = this.recycleBinUuid;
    if (!trashId) return;
    const trash = this.getGroup(trashId);
    if (!trash) return;
    trash.groups = [];
    trash.entries = [];
    this.reindex();
    this.markModified();
  }

  cloneEntry(id: string): KdbxEntry | undefined {
    const entry = this.getEntry(id);
    if (!entry || !entry.parentGroup) return undefined;
    const copy = this.db.createEntry(entry.parentGroup);
    copy.copyFrom(entry);
    const title = fieldToString(entry.fields.get('Title'));
    copy.fields.set('Title', title + ' (copy)');
    copy.times.update();
    this.entryIndex.set(uuidStr(copy.uuid), copy);
    this.markModified();
    return copy;
  }

  // history
  revertHistory(id: string, index: number): void {
    const entry = this.getEntry(id);
    if (!entry || !entry.history[index]) return;
    entry.pushHistory();
    entry.copyFrom(entry.history[index]);
    entry.times.update();
    this.markModified();
  }

  deleteHistory(id: string, index: number): void {
    const entry = this.getEntry(id);
    if (!entry) return;
    entry.removeHistory(index);
    this.markModified();
  }

  // meta
  setName(name: string): void {
    this.name = name;
    this.db.meta.name = name;
    this.markModified();
  }

  setDefaultUser(user: string): void {
    this.db.meta.defaultUser = user;
    this.markModified();
  }

  setHistoryMaxItems(count: number): void {
    this.db.meta.historyMaxItems = count;
    this.markModified();
  }

  setRecycleBinEnabled(enabled: boolean): void {
    this.db.meta.recycleBinEnabled = enabled;
    if (enabled && (!this.db.meta.recycleBinUuid || this.db.meta.recycleBinUuid.empty)) {
      this.db.createRecycleBin();
    }
    this.reindex();
    this.markModified();
  }

  /** Set the format version. `minor` only applies to major 4 (0 or 1 → 4.0/4.1). */
  setFormatVersion(version: 3 | 4, minor?: number): void {
    this.db.setVersion(version);
    if (version === 4 && minor !== undefined) {
      this.db.header.versionMinor = minor;
    }
    this.markModified();
  }

  /** Upgrade to the latest supported format (KDBX 4.1) + Argon2id KDF. */
  upgradeFormat(): void {
    this.db.setVersion(4);
    this.db.header.versionMinor = 1;
    this.db.setKdf(Consts.KdfId.Argon2id);
    this.markModified();
  }

  get versionLabel(): string {
    return `${this.db.versionMajor}.${this.db.versionMinor}`;
  }

  get isLatestFormat(): boolean {
    return this.db.versionMajor === 4 && this.db.versionMinor === 1;
  }

  /** kdf: 'AES' | 'Argon2d' | 'Argon2id' */
  setKdf(kdf: string): void {
    const id =
      kdf === 'Argon2d' ? Consts.KdfId.Argon2d : kdf === 'Argon2id' ? Consts.KdfId.Argon2id : Consts.KdfId.Aes;
    this.db.setKdf(id);
    this.markModified();
  }

  get defaultUser(): string {
    return this.db.meta.defaultUser ?? '';
  }

  get historyMaxItems(): number {
    return this.db.meta.historyMaxItems ?? 10;
  }

  get recycleBinEnabled(): boolean {
    return this.db.meta.recycleBinEnabled ?? true;
  }

  /**
   * Merge a remote copy of this database into the local one using kdbxweb's
   * KDBX three-way merge (by entry UUID, per-field modification timestamps,
   * entry history and the deletedObjects tombstone list — the same mechanism
   * KeePass/KeeWeb use, NOT a CRDT). The remote is loaded with the same
   * credentials; after merging, the local db reflects both sides and is ready
   * to save back.
   */
  async mergeRemote(remoteData: ArrayBuffer): Promise<void> {
    const remote = await Kdbx.load(remoteData, this.db.credentials);
    this.db.merge(remote);
    this.reindex();
    this.markModified();
  }

  /**
   * Import all entries from another database (opened with its own credentials)
   * into this file's default group. Returns the number of entries imported.
   */
  async importDatabase(data: ArrayBuffer, password: string | null, keyFile?: ArrayBuffer | null): Promise<number> {
    const credentials = new Credentials(
      password ? ProtectedValue.fromString(password) : null,
      keyFile ?? null
    );
    await credentials.ready;
    const source = await Kdbx.load(data, credentials);
    const target = this.db.getDefaultGroup();
    let count = 0;
    for (const entry of source.getDefaultGroup().allEntries()) {
      this.db.importEntry(entry, target, source);
      count++;
    }
    this.reindex();
    this.markModified();
    return count;
  }

  // ---- field references ----------------------------------------------------

  private refEntries(): RefEntry[] {
    const result: RefEntry[] = [];
    for (const entry of this.entryIndex.values()) {
      const f = entry.fields;
      result.push({
        uuidHex: this.uuidToHex(entry.uuid),
        title: fieldToString(f.get('Title')),
        username: fieldToString(f.get('UserName')),
        password: fieldToString(f.get('Password')),
        url: fieldToString(f.get('URL')),
        notes: fieldToString(f.get('Notes'))
      });
    }
    return result;
  }

  private uuidToHex(uuid: KdbxUuid): string {
    return Array.from(new Uint8Array(uuid.bytes))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /** Resolve any {REF:...} references in a value against this file's entries. */
  resolveReferences(value: string): string {
    if (!hasFieldReferences(value)) return value;
    return resolveFieldReferences(value, this.refEntries());
  }

  // ---- auto-type -----------------------------------------------------------

  setAutoType(id: string, config: { enabled?: boolean; obfuscation?: boolean; sequence?: string }): void {
    const entry = this.getEntry(id);
    if (!entry) return;
    entry.pushHistory();
    if (config.enabled !== undefined) entry.autoType.enabled = config.enabled;
    if (config.obfuscation !== undefined) entry.autoType.obfuscation = config.obfuscation ? 1 : 0;
    if (config.sequence !== undefined) {
      entry.autoType.defaultSequence = config.sequence || undefined;
    }
    entry.times.update();
    this.markModified();
  }

  getEffectiveAutoTypeSeq(id: string): string {
    const entry = this.getEntry(id);
    if (entry?.autoType.defaultSequence) return entry.autoType.defaultSequence;
    let g = entry?.parentGroup;
    while (g) {
      if (g.defaultAutoTypeSeq) return g.defaultAutoTypeSeq;
      g = g.parentGroup;
    }
    return '{USERNAME}{TAB}{PASSWORD}{ENTER}';
  }

  // ---- extra URLs ----------------------------------------------------------

  setExtraUrls(id: string, urls: string[]): void {
    const entry = this.getEntry(id);
    if (!entry) return;
    entry.pushHistory();
    // Remove existing KP2A_URL* fields, then re-add.
    for (const name of Array.from(entry.fields.keys())) {
      if (/^KP2A_URL(_\d+)?$/.test(name)) entry.fields.delete(name);
    }
    urls.forEach((url, i) => {
      if (!url) return;
      entry.fields.set(i === 0 ? 'KP2A_URL' : `KP2A_URL_${i}`, url);
    });
    entry.times.update();
    this.markModified();
  }

  // ---- tags ----------------------------------------------------------------

  renameTag(from: string, to: string): void {
    for (const entry of this.entryIndex.values()) {
      const idx = entry.tags.indexOf(from);
      if (idx >= 0) {
        entry.pushHistory();
        entry.tags.splice(idx, 1);
        if (to && !entry.tags.includes(to)) entry.tags.push(to);
        entry.times.update();
      }
    }
    this.markModified();
  }

  deleteTag(tag: string): void {
    this.renameTag(tag, '');
  }

  // ---- restore from trash --------------------------------------------------

  restoreEntry(id: string): void {
    const entry = this.getEntry(id);
    if (!entry) return;
    // Move to the previous parent group if known, else the root group.
    let target = this.db.getDefaultGroup();
    if (entry.previousParentGroup) {
      const prev = this.getGroup(entry.previousParentGroup.id);
      if (prev) target = prev;
    }
    this.db.move(entry, target);
    this.reindex();
    this.markModified();
  }

  // ---- entry templates -----------------------------------------------------

  getEntryTemplates(): { id: string; title: string; icon: number }[] {
    const templatesUuid = this.db.meta.entryTemplatesGroup;
    if (!templatesUuid || templatesUuid.empty) return [];
    const group = this.getGroup(templatesUuid.id);
    if (!group) return [];
    return group.entries.map((e) => ({
      id: uuidStr(e.uuid),
      title: fieldToString(e.fields.get('Title')),
      icon: e.icon ?? 0
    }));
  }

  createFromTemplate(templateId: string, groupId?: string): KdbxEntry | undefined {
    const template = this.getEntry(templateId);
    if (!template) return undefined;
    const group = groupId ? this.getGroup(groupId) : this.db.getDefaultGroup();
    const entry = this.db.createEntry(group ?? this.db.getDefaultGroup());
    entry.copyFrom(template);
    entry.times.update();
    this.entryIndex.set(uuidStr(entry.uuid), entry);
    this.markModified();
    return entry;
  }

  // ---- view-model projections ---------------------------------------------

  toVm(): FileVm {
    return {
      id: this.id,
      name: this.name,
      modified: this.modified,
      keyFileName: this.keyFileName,
      storage: this.storage,
      path: this.path,
      entryCount: this.entryIndex.size,
      formatVersion: this.db.versionMajor,
      versionLabel: this.versionLabel,
      isLatestFormat: this.isLatestFormat,
      kdf: this.readKdfName(),
      defaultUser: this.defaultUser,
      historyMaxItems: this.historyMaxItems,
      recycleBinEnabled: this.recycleBinEnabled,
      readOnly: this.readOnly
    };
  }

  readKdfName(): string {
    const kdf = this.db.header.kdfParameters?.get('$UUID');
    if (!kdf) return 'AES';
    const uuid =
      kdf instanceof ArrayBuffer || ArrayBuffer.isView(kdf)
        ? ByteUtils.bytesToBase64(kdf as ArrayBuffer)
        : String(kdf);
    if (uuid === Consts.KdfId.Argon2d) return 'Argon2d';
    if (uuid === Consts.KdfId.Argon2id) return 'Argon2id';
    return 'AES';
  }

  /**
   * Cache stamp for an entry's VM: captures everything {@link buildEntryVm}
   * reads that can change while the KdbxEntry object identity stays the same.
   *  - `lastModTime` — every field/tag/color/icon/expiry/attachment/auto-type
   *    mutation in this wrapper calls `entry.times.update()` (kdbxweb does NOT
   *    auto-touch times on `fields.set`, so the wrapper does it explicitly).
   *  - `history.length` — `deleteHistory` removes history without touching
   *    times.
   *  - parent group id + file-level {@link structuralRev} — moves, group
   *    renames/deletes, trash/restore, recycle-bin toggle and merges change
   *    `groupId`/`groupPath`/`inTrash` without touching the entry's own times.
   *  - the time-dependent `expired` flag, so a VM rebuilt after the expiry
   *    moment reflects it even when the entry itself was never edited.
   */
  private entryVmStamp(entry: KdbxEntry): string {
    const expiryTime = entry.times.expires ? entry.times.expiryTime?.getTime() : undefined;
    const expired = !!expiryTime && expiryTime < Date.now();
    return [
      entry.times.lastModTime?.getTime() ?? 0,
      entry.history.length,
      uuidStr(entry.parentGroup?.uuid),
      this.structuralRev,
      expired ? 1 : 0
    ].join('|');
  }

  entryToVm(entry: KdbxEntry): EntryVm {
    const stamp = this.entryVmStamp(entry);
    const cached = this.vmCache.get(entry);
    if (cached && cached.stamp === stamp) return cached.vm;
    const vm = this.buildEntryVm(entry);
    this.vmCache.set(entry, { stamp, vm });
    return vm;
  }

  private buildEntryVm(entry: KdbxEntry): EntryVm {
    const f = entry.fields;
    const custom: FieldVm[] = [];
    const extraUrls: string[] = [];
    for (const [name, value] of f) {
      if (BUILT_IN_FIELDS.has(name)) continue;
      if (/^KP2A_URL(_\d+)?$/.test(name)) {
        const v = fieldToString(value);
        if (v) extraUrls.push(v);
        continue;
      }
      custom.push({ name, value: fieldToString(value), protected: isProtected(value) });
    }
    const attachments: AttachmentVm[] = [];
    for (const [name, bin] of entry.binaries) {
      attachments.push({ name, size: binarySize(bin) });
    }
    const bgColor = entry.bgColor;
    const expiryTime = entry.times.expires ? entry.times.expiryTime?.getTime() : undefined;
    const path: string[] = [];
    let g = entry.parentGroup;
    while (g && g.parentGroup) {
      path.unshift(g.name ?? '');
      g = g.parentGroup;
    }
    const title = fieldToString(f.get(STD.title));
    const username = fieldToString(f.get(STD.username));
    const password = fieldToString(f.get(STD.password));
    const url = fieldToString(f.get(STD.url));
    const notes = fieldToString(f.get(STD.notes));
    const at = entry.autoType;
    return {
      id: uuidStr(entry.uuid),
      fileId: this.id,
      groupId: uuidStr(entry.parentGroup?.uuid),
      title,
      username,
      password,
      passwordProtected: isProtected(f.get(STD.password)),
      url,
      extraUrls,
      notes,
      fields: custom,
      tags: entry.tags.slice(),
      icon: entry.icon ?? 0,
      customIcon: uuidStr(entry.customIcon) || undefined,
      fgColor: entry.fgColor,
      bgColor,
      color: nearestNamedColor(bgColor),
      attachments,
      otp: fieldToString(f.get(STD.otp)) || undefined,
      created: entry.times.creationTime?.getTime() ?? 0,
      updated: entry.times.lastModTime?.getTime() ?? 0,
      expires: expiryTime,
      expired: !!expiryTime && expiryTime < Date.now(),
      historyLength: entry.history.length,
      inTrash: this.isInTrash(entry),
      groupPath: path,
      autoType: {
        enabled: at.enabled !== false,
        obfuscation: at.obfuscation === 1,
        sequence: at.defaultSequence,
        items: at.items.map((it) => ({ window: it.window, sequence: it.keystrokeSequence }))
      },
      hasReferences:
        hasFieldReferences(title) ||
        hasFieldReferences(username) ||
        hasFieldReferences(password) ||
        hasFieldReferences(url) ||
        hasFieldReferences(notes)
    };
  }

  getAllEntries(includeTrash = false): EntryVm[] {
    const result: EntryVm[] = [];
    for (const entry of this.entryIndex.values()) {
      const vm = this.entryToVm(entry);
      if (!includeTrash && vm.inTrash) continue;
      result.push(vm);
    }
    return result;
  }

  groupToVm(group: KdbxGroup): GroupVm {
    const trashId = this.recycleBinUuid;
    const rootId = uuidStr(this.db.getDefaultGroup().uuid);
    const id = uuidStr(group.uuid);
    const children = group.groups.map((g) => this.groupToVm(g));
    let total = group.entries.length;
    for (const c of children) total += c.totalEntryCount;
    return {
      id,
      fileId: this.id,
      name: group.name ?? '',
      icon: group.icon ?? 48,
      customIcon: uuidStr(group.customIcon) || undefined,
      parentId: group.parentGroup ? uuidStr(group.parentGroup.uuid) : undefined,
      entryCount: group.entries.length,
      totalEntryCount: total,
      expanded: group.expanded ?? true,
      isRecycleBin: id === trashId,
      isRoot: id === rootId,
      children
    };
  }

  getGroupTree(): GroupVm {
    return this.groupToVm(this.db.getDefaultGroup());
  }

  getAllTags(): string[] {
    const tags = new Set<string>();
    for (const entry of this.entryIndex.values()) {
      for (const tag of entry.tags) tags.add(tag);
    }
    return Array.from(tags).sort((a, b) => a.localeCompare(b));
  }
}
