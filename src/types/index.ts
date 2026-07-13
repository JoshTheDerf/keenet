/** App-level view-model types. These are plain, serializable projections of the
 * underlying kdbxweb objects — the UI renders these, mutations go through the
 * KdbxFile service which re-derives them. This keeps Vue reactivity simple and
 * the kdbxweb objects as the single source of truth. */

export type Uuid = string;

export interface FieldVm {
  name: string;
  value: string;
  protected: boolean;
}

export interface AttachmentVm {
  name: string;
  /** byte length */
  size: number;
}

export interface EntryVm {
  id: Uuid;
  fileId: string;
  groupId: Uuid;
  title: string;
  username: string;
  password: string;
  passwordProtected: boolean;
  url: string;
  /** additional URLs stored in KP2A_URL / KP2A_URL_n fields */
  extraUrls: string[];
  notes: string;
  /** custom (non-standard) fields */
  fields: FieldVm[];
  tags: string[];
  icon: number;
  customIcon?: string;
  fgColor?: string;
  bgColor?: string;
  /** entry background color mapped to a named palette color, if any */
  color?: string;
  attachments: AttachmentVm[];
  otp?: string; // otpauth uri or bare secret
  created: number;
  updated: number;
  expires?: number;
  expired: boolean;
  historyLength: number;
  inTrash: boolean;
  /** breadcrumb path of group names */
  groupPath: string[];
  /** auto-type configuration (desktop feature; config stored regardless) */
  autoType: AutoTypeVm;
  /** true if any standard field contains a {REF:...} field reference */
  hasReferences: boolean;
}

export interface AutoTypeVm {
  enabled: boolean;
  obfuscation: boolean;
  sequence?: string;
  items: { window: string; sequence: string }[];
}

export interface GroupVm {
  id: Uuid;
  fileId: string;
  name: string;
  icon: number;
  customIcon?: string;
  parentId?: Uuid;
  entryCount: number;
  /** total including nested */
  totalEntryCount: number;
  expanded: boolean;
  isRecycleBin: boolean;
  isRoot: boolean;
  children: GroupVm[];
}

export interface FileVm {
  id: string;
  name: string;
  modified: boolean;
  keyFileName?: string;
  storage: StorageType;
  path?: string;
  entryCount: number;
  /** major version number (3 or 4) — for the version selector */
  formatVersion: number;
  /** full version label, e.g. "4.1" */
  versionLabel: string;
  isLatestFormat: boolean;
  kdf: string;
  defaultUser: string;
  historyMaxItems: number;
  recycleBinEnabled: boolean;
  readOnly: boolean;
}

export type StorageType =
  | 'file'
  | 'fsaccess'
  | 'memory'
  | 'webdav'
  | 'dropbox'
  | 'gdrive'
  | 'onedrive'
  | 'demo';

export interface OpenParams {
  name: string;
  password?: string;
  keyFileData?: ArrayBuffer | null;
  keyFileName?: string;
  fileData: ArrayBuffer;
  storage?: StorageType;
  path?: string;
  /** File System Access handle, when opened from a local file, for save-back. */
  fsHandle?: FileSystemFileHandle;
}

export interface NewFileParams {
  name: string;
  password?: string;
  keyFileData?: ArrayBuffer | null;
  keyFileName?: string;
}

/** Left-menu selection driving what the entry list shows. */
export type MenuSelection =
  | { type: 'all' }
  | { type: 'group'; fileId: string; groupId: Uuid }
  | { type: 'trash'; fileId?: string }
  | { type: 'tag'; tag: string }
  | { type: 'color'; color: string }
  | { type: 'expired' };

export type SortField = 'title' | 'username' | 'url' | 'created' | 'updated' | 'expires';
export type SortDir = 'asc' | 'desc';

export const NAMED_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'violet'] as const;
export type NamedColor = (typeof NAMED_COLORS)[number];

/** KeePass fg/bg hex → named color palette used for entry coloring. */
export const COLOR_HEX: Record<NamedColor, string> = {
  red: '#f5524c',
  orange: '#f5a623',
  yellow: '#f8e71c',
  green: '#7ed321',
  blue: '#4a90e2',
  violet: '#9013fe'
};
