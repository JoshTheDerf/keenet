import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import type { GeneratorPreset } from '@/domain/generator';
import { DEFAULT_BACKUP_PATH } from '@/storage/backup';
import { secretStore, WEBDAV_PASSWORD_KEY } from '@/storage/secret-store';

export type ThemeName =
  | 'dark'
  | 'light'
  | 'sd'
  | 'sl'
  | 'fb'
  | 'bl'
  | 'db'
  | 'lb'
  | 'te'
  | 'lt'
  | 'hc'
  | 'dc';

export interface WebdavConfig {
  url: string;
  user: string;
  /** Never serialized into the settings blob — persisted via the secret store. */
  password: string;
}

/** What actually lands in the localStorage blob for webdav: NO password. */
type PersistedWebdav = Omit<WebdavConfig, 'password'>;

interface PersistedSettings {
  theme: ThemeName;
  autoSwitchTheme: boolean;
  locale: string;
  fontSize: 0 | 1 | 2;
  tableView: boolean;
  expandGroups: boolean;
  colorfulIcons: boolean;
  useMarkdown: boolean;
  autoSave: boolean;
  autoSaveInterval: number;
  clipboardSeconds: number;
  idleMinutes: number;
  lockOnCopy: boolean;
  lockOnMinimize: boolean;
  auditPasswords: boolean;
  generatorHidePassword: boolean;
  generatorPresets: GeneratorPreset[];
  webdav: PersistedWebdav;
  rememberedFiles: RememberedFile[];
  // storage
  storageEnabled: Record<string, boolean>;
  cloudKeys: CloudKeys;
  // backup
  backupEnabled: boolean;
  backupCount: number;
  /** Also write timestamped copies to the file's own storage backend. */
  backupStorage: boolean;
  /** Path template for storage backups ({name}/{date}/{time}). */
  backupStoragePath: string;
  // sync
  syncOnSave: boolean;
  // mobile
  biometricLock: boolean;
}

/** Optional custom OAuth client ids (override the embedded defaults). */
export interface CloudKeys {
  dropboxAppKey: string;
  gdriveClientId: string;
  onedriveClientId: string;
}

export interface RememberedFile {
  name: string;
  storage: string;
  path?: string;
  keyFileName?: string;
}

const STORAGE_KEY = 'keeweb-settings';

const DEFAULTS: PersistedSettings = {
  theme: 'dark',
  autoSwitchTheme: false,
  locale: 'en-us',
  fontSize: 0,
  tableView: false,
  expandGroups: true,
  colorfulIcons: false,
  useMarkdown: true,
  autoSave: true,
  autoSaveInterval: 0,
  clipboardSeconds: 45,
  idleMinutes: 15,
  lockOnCopy: false,
  lockOnMinimize: false,
  auditPasswords: true,
  generatorHidePassword: false,
  generatorPresets: [],
  webdav: { url: '', user: '' },
  rememberedFiles: [],
  storageEnabled: { webdav: true, dropbox: true, gdrive: true, onedrive: true },
  cloudKeys: { dropboxAppKey: '', gdriveClientId: '', onedriveClientId: '' },
  backupEnabled: false,
  backupCount: 10,
  backupStorage: false,
  backupStoragePath: DEFAULT_BACKUP_PATH,
  syncOnSave: true,
  biometricLock: true
};

function load(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* ignore corrupt settings */
  }
  return { ...DEFAULTS };
}

export const useSettingsStore = defineStore('settings', () => {
  const initial = load();

  const theme = ref<ThemeName>(initial.theme);
  const autoSwitchTheme = ref(initial.autoSwitchTheme);
  const locale = ref(initial.locale);
  const fontSize = ref(initial.fontSize);
  const tableView = ref(initial.tableView);
  const expandGroups = ref(initial.expandGroups);
  const colorfulIcons = ref(initial.colorfulIcons);
  const useMarkdown = ref(initial.useMarkdown);
  const autoSave = ref(initial.autoSave);
  const autoSaveInterval = ref(initial.autoSaveInterval);
  const clipboardSeconds = ref(initial.clipboardSeconds);
  const idleMinutes = ref(initial.idleMinutes);
  const lockOnCopy = ref(initial.lockOnCopy);
  const lockOnMinimize = ref(initial.lockOnMinimize);
  const auditPasswords = ref(initial.auditPasswords);
  const generatorHidePassword = ref(initial.generatorHidePassword);
  const generatorPresets = ref<GeneratorPreset[]>(initial.generatorPresets);

  // The webdav password lives in the secret store (OS keychain on desktop/
  // mobile), never in the settings blob. main.ts awaits secretStore.preload()
  // before this store is created, so getCached() is already hydrated; the
  // async get() below covers stores created without preload (tests, embeds)
  // and only fills the ref while it is still empty (never clobbers user input).
  const webdav = ref<WebdavConfig>({
    url: initial.webdav.url,
    user: initial.webdav.user,
    password: secretStore.getCached(WEBDAV_PASSWORD_KEY) ?? ''
  });
  void secretStore.get(WEBDAV_PASSWORD_KEY).then((pw) => {
    if (pw !== null && webdav.value.password === '') webdav.value.password = pw;
  });
  watch(
    () => webdav.value.password,
    (pw) => {
      void (pw ? secretStore.set(WEBDAV_PASSWORD_KEY, pw) : secretStore.remove(WEBDAV_PASSWORD_KEY));
    }
  );

  const rememberedFiles = ref<RememberedFile[]>(initial.rememberedFiles);
  const storageEnabled = ref<Record<string, boolean>>(initial.storageEnabled);
  const cloudKeys = ref<CloudKeys>(initial.cloudKeys);
  const backupEnabled = ref(initial.backupEnabled);
  const backupCount = ref(initial.backupCount);
  const backupStorage = ref(initial.backupStorage);
  const backupStoragePath = ref(initial.backupStoragePath);
  const syncOnSave = ref(initial.syncOnSave);
  const biometricLock = ref(initial.biometricLock);

  function persist(): void {
    const data: PersistedSettings = {
      theme: theme.value,
      autoSwitchTheme: autoSwitchTheme.value,
      locale: locale.value,
      fontSize: fontSize.value,
      tableView: tableView.value,
      expandGroups: expandGroups.value,
      colorfulIcons: colorfulIcons.value,
      useMarkdown: useMarkdown.value,
      autoSave: autoSave.value,
      autoSaveInterval: autoSaveInterval.value,
      clipboardSeconds: clipboardSeconds.value,
      idleMinutes: idleMinutes.value,
      lockOnCopy: lockOnCopy.value,
      lockOnMinimize: lockOnMinimize.value,
      auditPasswords: auditPasswords.value,
      generatorHidePassword: generatorHidePassword.value,
      generatorPresets: generatorPresets.value,
      // Deliberately NOT webdav.value: the password must never reach the blob.
      webdav: { url: webdav.value.url, user: webdav.value.user },
      rememberedFiles: rememberedFiles.value,
      storageEnabled: storageEnabled.value,
      cloudKeys: cloudKeys.value,
      backupEnabled: backupEnabled.value,
      backupCount: backupCount.value,
      backupStorage: backupStorage.value,
      backupStoragePath: backupStoragePath.value,
      syncOnSave: syncOnSave.value,
      biometricLock: biometricLock.value
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* storage full / disabled */
    }
  }

  watch(
    [
      theme,
      autoSwitchTheme,
      locale,
      fontSize,
      tableView,
      expandGroups,
      colorfulIcons,
      useMarkdown,
      autoSave,
      autoSaveInterval,
      clipboardSeconds,
      idleMinutes,
      lockOnCopy,
      lockOnMinimize,
      auditPasswords,
      generatorHidePassword,
      generatorPresets,
      webdav,
      rememberedFiles,
      storageEnabled,
      cloudKeys,
      backupEnabled,
      backupCount,
      backupStorage,
      backupStoragePath,
      syncOnSave,
      biometricLock
    ],
    persist,
    { deep: true }
  );

  function rememberFile(file: RememberedFile): void {
    const existing = rememberedFiles.value.findIndex(
      (f) => f.name === file.name && f.storage === file.storage
    );
    if (existing >= 0) rememberedFiles.value.splice(existing, 1);
    rememberedFiles.value.unshift(file);
    rememberedFiles.value = rememberedFiles.value.slice(0, 8);
  }

  return {
    theme,
    autoSwitchTheme,
    locale,
    fontSize,
    tableView,
    expandGroups,
    colorfulIcons,
    useMarkdown,
    autoSave,
    autoSaveInterval,
    clipboardSeconds,
    idleMinutes,
    lockOnCopy,
    lockOnMinimize,
    auditPasswords,
    generatorHidePassword,
    generatorPresets,
    webdav,
    rememberedFiles,
    storageEnabled,
    cloudKeys,
    backupEnabled,
    backupCount,
    backupStorage,
    backupStoragePath,
    syncOnSave,
    biometricLock,
    rememberFile,
    persist
  };
});
