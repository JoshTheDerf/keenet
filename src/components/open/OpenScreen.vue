<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { t } from '@/i18n';
import { loadStartupConfig } from '@/integrations/nextcloud';
import { pickDatabaseFile, pickFileViaInput } from '@/storage/local';
import { getProvider } from '@/storage';
import { useVaultStore } from '@/stores/vault';
import { useUiStore } from '@/stores/ui';
import { useSettingsStore, type RememberedFile } from '@/stores/settings';
import type { StorageType } from '@/types';
import MasterPasswordField from './MasterPasswordField.vue';
import NewFileDialog from './NewFileDialog.vue';
import WebdavDialog from './WebdavDialog.vue';
import StorageOpenDialog from './StorageOpenDialog.vue';
import GeneratorQuickModal from './GeneratorQuickModal.vue';
import KeeNetLogo from '@/components/shared/KeeNetLogo.vue';

const vault = useVaultStore();
const ui = useUiStore();
const settings = useSettingsStore();

interface PickedDb {
  name: string;
  data: ArrayBuffer;
  handle?: FileSystemFileHandle;
}

const picked = ref<PickedDb | null>(null);
const storageType = ref<StorageType>('file');
const storagePath = ref<string | undefined>(undefined);

const password = ref('');
const keyFileData = ref<ArrayBuffer | null>(null);
const keyFileName = ref<string | null>(null);

const error = ref<string | null>(null);
const unlocking = ref(false);
const shake = ref(false);
const dragging = ref(false);

const newOpen = ref(false);
const webdavOpen = ref(false);
const storageOpen = ref(false);
const generatorOpen = ref(false);

// True while the ?config= startup flow is fetching + downloading a file.
const startupLoading = ref(false);

const recentFiles = computed(() => settings.rememberedFiles);

function resetUnlock(): void {
  password.value = '';
  keyFileData.value = null;
  keyFileName.value = null;
  error.value = null;
}

function setPicked(file: PickedDb, storage: StorageType, path?: string): void {
  picked.value = file;
  storageType.value = storage;
  storagePath.value = path;
  resetUnlock();
}

function clearPicked(): void {
  picked.value = null;
  storageType.value = 'file';
  storagePath.value = undefined;
  resetUnlock();
}

async function openLocal(): Promise<void> {
  const file = await pickDatabaseFile();
  if (file) setPicked({ name: file.name, data: file.data, handle: file.handle }, 'file');
}

// ---- recent files ---------------------------------------------------------

/** Key of the recent entry currently being downloaded (shows a spinner). */
const recentBusy = ref<string | null>(null);

function recentKey(file: RememberedFile): string {
  return `${file.storage}:${file.name}`;
}

function recentIcon(file: RememberedFile): string {
  return getProvider(file.storage)?.icon ?? 'i-lucide-file-lock-2';
}

/** Provider config for a direct (non-browsed) load; mirrors the vault store. */
function recentConfig(storage: string): Record<string, string> | undefined {
  if (storage === 'webdav') {
    return {
      url: settings.webdav.url,
      user: settings.webdav.user,
      password: settings.webdav.password
    };
  }
  return undefined;
}

/**
 * Reopen a recent file from the storage it came from, prompting only for the
 * master password. Local picks still need the file picker (we can't retain
 * handles here); unauthorized/unconfigured providers fall back to the storage
 * dialog with a toast explaining why.
 */
async function openRecent(file: RememberedFile): Promise<void> {
  if (recentBusy.value) return;
  const provider = file.path ? getProvider(file.storage) : undefined;
  if (file.storage === 'file' || !file.path || !provider) {
    await openLocal();
    return;
  }
  if (provider.oauth && provider.isAuthorized?.() === false) {
    ui.notify(t('openRecentSignIn'), {
      color: 'info',
      description: t('openRecentSignInBody', provider.title)
    });
    storageOpen.value = true;
    return;
  }
  recentBusy.value = recentKey(file);
  try {
    const res = await provider.load(file.path, recentConfig(file.storage));
    setPicked({ name: file.name, data: res.data }, file.storage as StorageType, file.path);
  } catch (e) {
    ui.notify(t('openError'), {
      color: 'error',
      description: e instanceof Error ? e.message : String(e)
    });
    // Let the user re-enter credentials / re-pick the file.
    if (file.storage === 'webdav') webdavOpen.value = true;
    else storageOpen.value = true;
  } finally {
    recentBusy.value = null;
  }
}

async function selectKeyFile(): Promise<void> {
  const file = await pickFileViaInput('.key,.keyx');
  if (file) {
    keyFileData.value = file.data;
    keyFileName.value = file.name;
  }
}

function clearKeyFile(): void {
  keyFileData.value = null;
  keyFileName.value = null;
}

function triggerShake(): void {
  shake.value = false;
  requestAnimationFrame(() => {
    shake.value = true;
    setTimeout(() => (shake.value = false), 500);
  });
}

async function unlock(): Promise<void> {
  if (!picked.value || unlocking.value) return;
  unlocking.value = true;
  error.value = null;
  try {
    await vault.openFile({
      name: picked.value.name,
      fileData: picked.value.data,
      password: password.value,
      keyFileData: keyFileData.value,
      keyFileName: keyFileName.value ?? undefined,
      storage: storageType.value,
      path: storagePath.value,
      fsHandle: picked.value.handle
    });
    settings.rememberFile({
      name: picked.value.name,
      storage: storageType.value,
      path: storagePath.value,
      keyFileName: keyFileName.value ?? undefined
    });
    ui.showScreen('app');
  } catch {
    error.value = t('openErrorDescription');
    triggerShake();
    password.value = '';
  } finally {
    unlocking.value = false;
  }
}

async function onCreate(payload: { name: string; password: string }): Promise<void> {
  await vault.createFile({ name: payload.name, password: payload.password });
  newOpen.value = false;
  ui.showScreen('app');
}

async function openDemo(): Promise<void> {
  await vault.createFile({ name: 'Demo', password: 'demo' });
  ui.showScreen('app');
}

function onWebdavLoaded(payload: {
  name: string;
  data: ArrayBuffer;
  url: string;
}): void {
  setPicked({ name: payload.name, data: payload.data }, 'webdav', payload.url);
}

function onStorageLoaded(p: {
  name: string;
  data: ArrayBuffer;
  storage: string;
  path: string;
}): void {
  setPicked({ name: p.name, data: p.data }, p.storage as StorageType, p.path);
}

// When launched with a `?config=` param (e.g. embedded in the Nextcloud app),
// pull the referenced file over the ambient session and jump straight to the
// unlock stage.
onMounted(async () => {
  // Show the loader up-front when a file was requested, since downloading it
  // over WebDAV can take a moment.
  const requested = new URLSearchParams(window.location.search).has('config');
  if (!requested) return;
  startupLoading.value = true;
  try {
    const startup = await loadStartupConfig();
    if (startup) {
      setPicked({ name: startup.name, data: startup.data }, startup.storage as StorageType, startup.path);
    }
  } catch (e) {
    ui.notify(t('openError'), {
      color: 'error',
      description: e instanceof Error ? e.message : String(e)
    });
  } finally {
    startupLoading.value = false;
  }
});

async function onDrop(e: DragEvent): Promise<void> {
  dragging.value = false;
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.kdbx')) {
    error.value = t('openWrongFileBody');
    return;
  }
  const data = await file.arrayBuffer();
  setPicked({ name: file.name, data }, 'file');
}
</script>

<template>
  <div
    class="relative flex min-h-full w-full items-center justify-center overflow-y-auto p-6"
    @dragover.prevent="dragging = true"
    @dragenter.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="onDrop"
  >
    <!-- back to the already-open vault (when adding another database) -->
    <div v-if="vault.hasFiles" class="absolute left-4 top-4">
      <UButton
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
:label="t('openBackToVault')"
        @click="ui.showScreen('app')"
      />
    </div>

    <!-- top-right quick actions -->
    <div class="absolute right-4 top-4 flex items-center gap-1">
      <UTooltip :text="t('footerTitleGen')">
        <UButton
          icon="i-lucide-zap"
          color="neutral"
          variant="ghost"
          :aria-label="t('footerTitleGen')"
          @click="generatorOpen = true"
        />
      </UTooltip>
      <UTooltip :text="t('settings')">
        <UButton
          icon="i-lucide-settings"
          color="neutral"
          variant="ghost"
          :aria-label="t('settings')"
          @click="ui.openSettings()"
        />
      </UTooltip>
    </div>

    <!-- drop overlay -->
    <div
      v-if="dragging"
      class="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 border-2 border-dashed border-primary bg-default/80 backdrop-blur-sm"
    >
      <UIcon name="i-lucide-lock" class="size-12 text-primary" />
      <p class="text-lg font-medium text-muted">{{ t('openDropHere') }}</p>
    </div>

    <UCard class="w-full max-w-md" :class="{ 'kw-shake': shake }">
      <!-- branding -->
      <div class="flex flex-col items-center gap-2 py-2 text-center">
        <KeeNetLogo class="size-14" />
        <h1 class="text-2xl font-semibold tracking-tight">KeeNet</h1>
        <p class="text-sm text-muted">{{ t('openTagline') }}</p>
      </div>

      <USeparator class="my-4" />

      <!-- startup open (downloading a file handed to us via ?config=) -->
      <div v-if="startupLoading" class="flex flex-col items-center gap-3 py-8 text-center">
        <UIcon name="i-lucide-loader-circle" class="size-8 animate-spin text-primary" />
        <p class="text-sm text-muted">{{ t('openOpeningDb') }}</p>
      </div>

      <!-- choose stage -->
      <div v-else-if="!picked" class="flex flex-col gap-4">
        <div class="grid grid-cols-2 gap-2">
          <UButton
            block
            size="lg"
            color="primary"
            icon="i-lucide-folder-open"
            :label="t('openOpen')"
            @click="openLocal"
          />
          <UButton
            block
            size="lg"
            color="neutral"
            variant="subtle"
            icon="i-lucide-plus"
            :label="t('openNew')"
            @click="newOpen = true"
          />
          <UButton
            block
            size="lg"
            color="neutral"
            variant="subtle"
            icon="i-lucide-server"
            :label="t('webdav')"
            @click="webdavOpen = true"
          />
          <UButton
            block
            size="lg"
            color="neutral"
            variant="subtle"
            icon="i-lucide-cloud"
:label="t('openStorage')"
            @click="storageOpen = true"
          />
          <UButton
            block
            size="lg"
            color="neutral"
            variant="subtle"
            icon="i-lucide-wand-sparkles"
            :label="t('openTryDemo')"
            @click="openDemo"
          />
        </div>

        <!-- recent files -->
        <div v-if="recentFiles.length" class="flex flex-col gap-1">
          <p class="px-1 text-xs font-medium uppercase tracking-wide text-dimmed">{{ t('openRecent') }}</p>
          <UButton
            v-for="file in recentFiles"
            :key="recentKey(file)"
            color="neutral"
            variant="ghost"
            class="justify-start"
            :icon="recentIcon(file)"
            :loading="recentBusy === recentKey(file)"
            :disabled="!!recentBusy"
            @click="openRecent(file)"
          >
            <span class="truncate">{{ file.name }}</span>
          </UButton>
        </div>
      </div>

      <!-- unlock stage -->
      <div v-else class="flex flex-col gap-4">
        <button
          type="button"
          class="flex items-center gap-2 self-start text-sm text-muted transition-colors hover:text-default"
          @click="clearPicked"
        >
          <UIcon name="i-lucide-arrow-left" />
          <span class="truncate font-medium text-default">{{ picked.name }}</span>
        </button>

        <UFormField :label="t('setFilePass')">
          <MasterPasswordField
            v-model="password"
            :placeholder="t('openClickToOpen')"
            autofocus
            @enter="unlock"
          />
        </UFormField>

        <div class="flex items-center justify-between gap-2">
          <UButton
            color="neutral"
            variant="link"
            size="sm"
            icon="i-lucide-key"
            :label="keyFileName ?? t('openKeyFile')"
            @click="selectKeyFile"
          />
          <UButton
            v-if="keyFileName"
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-x"
            :aria-label="t('alertClose')"
            @click="clearKeyFile"
          />
        </div>

        <UAlert
          v-if="error"
          color="error"
          variant="soft"
          icon="i-lucide-circle-alert"
:title="t('openError')"
          :description="error"
        />

        <UButton
          block
          size="lg"
          color="primary"
          icon="i-lucide-unlock"
:label="t('openUnlock')"
          :loading="unlocking"
          @click="unlock"
        />
      </div>
    </UCard>

    <NewFileDialog v-model:open="newOpen" @submit="onCreate" />
    <WebdavDialog v-model:open="webdavOpen" @loaded="onWebdavLoaded" />
    <StorageOpenDialog v-model:open="storageOpen" @loaded="onStorageLoaded" />
    <GeneratorQuickModal v-model:open="generatorOpen" />
  </div>
</template>

<style scoped>
@keyframes kw-shake {
  0%,
  100% {
    transform: translateX(0);
  }
  20%,
  60% {
    transform: translateX(-8px);
  }
  40%,
  80% {
    transform: translateX(8px);
  }
}

.kw-shake {
  animation: kw-shake 0.4s ease-in-out;
}
</style>
