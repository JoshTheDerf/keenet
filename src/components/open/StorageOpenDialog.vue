<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { t } from '@/i18n';
import { PROVIDERS } from '@/storage';
import type { StorageProvider, StorageDirEntry } from '@/storage/types';
import {
  chooseFolder,
  hasFolder,
  supportsFileSystemAccess
} from '@/storage/filesystem';
import { useSettingsStore } from '@/stores/settings';

const open = defineModel<boolean>('open', { default: false });

const emit = defineEmits<{
  loaded: [payload: { name: string; data: ArrayBuffer; storage: string; path: string }];
}>();

const settings = useSettingsStore();

interface Crumb {
  name: string;
  path: string;
}

const selectedProvider = ref<StorageProvider | null>(null);
const crumbs = ref<Crumb[]>([]);
const entries = ref<StorageDirEntry[]>([]);
const loading = ref(false);
const authorizing = ref(false);
const error = ref<string | null>(null);

/** Providers that can be browsed here: must support `list`, be enabled, and
 *  not be WebDAV (which has its own dedicated dialog). */
const availableProviders = computed(() =>
  PROVIDERS.filter(
    (p) =>
      typeof p.list === 'function' &&
      p.type !== 'webdav' &&
      settings.storageEnabled[p.type] !== false
  )
);

const currentDir = computed(() => crumbs.value[crumbs.value.length - 1]?.path ?? '');

/** Only folders and `.kdbx` files are relevant; everything else is hidden. */
const visibleEntries = computed(() =>
  entries.value.filter((e) => e.dir || e.name.toLowerCase().endsWith('.kdbx'))
);

const isEmpty = computed(
  () => !loading.value && !authorizing.value && !error.value && visibleEntries.value.length === 0
);

function resetState(): void {
  selectedProvider.value = null;
  crumbs.value = [];
  entries.value = [];
  error.value = null;
  loading.value = false;
  authorizing.value = false;
}

watch(open, (isOpen) => {
  if (isOpen) resetState();
});

function toMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** List the current directory without re-running auth/permission checks. */
async function listCurrent(): Promise<void> {
  const provider = selectedProvider.value;
  if (!provider?.list) return;
  loading.value = true;
  error.value = null;
  try {
    entries.value = await provider.list(currentDir.value);
  } catch (e) {
    entries.value = [];
    error.value = toMessage(e);
  } finally {
    loading.value = false;
  }
}

/** Ensure the provider is ready (folder chosen / signed in), then list root. */
async function prepareAndList(): Promise<void> {
  const provider = selectedProvider.value;
  if (!provider?.list) return;
  loading.value = true;
  error.value = null;
  try {
    if (provider.type === 'fsaccess') {
      if (!supportsFileSystemAccess()) {
        throw new Error(t('setStorageNotSupported'));
      }
      if (!(await hasFolder())) {
        const ok = await chooseFolder();
        if (!ok) {
          // User cancelled the folder picker → return to the provider list.
          resetState();
          return;
        }
      }
    } else if (provider.oauth && provider.isAuthorized?.() === false) {
      authorizing.value = true;
      try {
        await provider.authorize?.();
      } finally {
        authorizing.value = false;
      }
    }
    entries.value = await provider.list(currentDir.value);
  } catch (e) {
    entries.value = [];
    error.value = toMessage(e);
  } finally {
    loading.value = false;
  }
}

async function enterProvider(provider: StorageProvider): Promise<void> {
  selectedProvider.value = provider;
  crumbs.value = [{ name: provider.title, path: '' }];
  entries.value = [];
  error.value = null;
  await prepareAndList();
}

function backToProviders(): void {
  resetState();
}

async function openDir(entry: StorageDirEntry): Promise<void> {
  crumbs.value.push({ name: entry.name, path: entry.path });
  await listCurrent();
}

async function goToCrumb(index: number): Promise<void> {
  if (index >= crumbs.value.length - 1) return;
  crumbs.value = crumbs.value.slice(0, index + 1);
  await listCurrent();
}

async function selectFile(entry: StorageDirEntry): Promise<void> {
  const provider = selectedProvider.value;
  if (!provider || loading.value) return;
  loading.value = true;
  error.value = null;
  try {
    const res = await provider.load(entry.path);
    emit('loaded', {
      name: entry.name,
      data: res.data,
      storage: provider.type,
      path: entry.path
    });
    open.value = false;
  } catch (e) {
    error.value = toMessage(e);
  } finally {
    loading.value = false;
  }
}

function onEntryClick(entry: StorageDirEntry): void {
  if (entry.dir) void openDir(entry);
  else void selectFile(entry);
}
</script>

<template>
  <UModal v-model:open="open" :title="t('openFromStorage')">
    <template #body>
      <!-- Provider selection -->
      <div v-if="!selectedProvider" class="flex flex-col gap-2">
        <p class="text-sm text-muted">{{ t('openStorageChoose') }}</p>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            v-for="provider in availableProviders"
            :key="provider.type"
            type="button"
            class="flex items-center gap-3 rounded-lg border border-default p-3 text-left transition-colors hover:border-primary hover:bg-elevated"
            @click="enterProvider(provider)"
          >
            <UIcon :name="provider.icon" class="size-6 shrink-0 text-primary" />
            <span class="flex min-w-0 flex-col">
              <span class="truncate font-medium">{{ provider.title }}</span>
              <span
                v-if="provider.oauth && provider.isAuthorized?.() === false"
                class="text-xs text-dimmed"
              >
                {{ t('openSignInRequired') }}
              </span>
            </span>
          </button>
        </div>
        <UAlert
          v-if="!availableProviders.length"
          color="neutral"
          variant="soft"
          icon="i-lucide-info"
:title="t('openNoProviders')"
          :description="t('openNoProvidersBody')"
        />
      </div>

      <!-- File browser -->
      <div v-else class="flex min-h-64 flex-col gap-3">
        <!-- breadcrumb / up affordance -->
        <nav class="flex flex-wrap items-center gap-1 text-sm">
          <template v-for="(crumb, i) in crumbs" :key="i">
            <UIcon v-if="i > 0" name="i-lucide-chevron-right" class="size-4 text-dimmed" />
            <button
              type="button"
              class="rounded px-1 transition-colors hover:text-primary"
              :class="i === crumbs.length - 1 ? 'font-medium text-default' : 'text-muted'"
              @click="goToCrumb(i)"
            >
              {{ crumb.name }}
            </button>
          </template>
        </nav>

        <!-- signing in -->
        <div v-if="authorizing" class="flex flex-col items-center justify-center gap-3 py-10">
          <UProgress />
          <p class="text-sm text-muted">{{ t('openSigningIn') }}</p>
        </div>

        <!-- error -->
        <template v-else-if="error">
          <UAlert
            color="error"
            variant="soft"
            icon="i-lucide-circle-alert"
            :title="t('openError')"
            :description="error"
          />
          <div class="flex gap-2">
            <UButton
              color="primary"
              variant="soft"
              icon="i-lucide-refresh-cw"
              :label="t('retry')"
              @click="prepareAndList"
            />
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-arrow-left"
              :label="t('back')"
              @click="backToProviders"
            />
          </div>
        </template>

        <!-- loading -->
        <div v-else-if="loading" class="flex flex-col items-center justify-center gap-3 py-10">
          <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-primary" />
          <p class="text-sm text-muted">{{ t('loading') }}</p>
        </div>

        <!-- empty -->
        <div
          v-else-if="isEmpty"
          class="flex flex-col items-center justify-center gap-2 py-10 text-center"
        >
          <UIcon name="i-lucide-folder-open" class="size-8 text-dimmed" />
          <p class="text-sm text-muted">{{ t('openNoKdbxHere') }}</p>
        </div>

        <!-- entries -->
        <ul v-else class="flex flex-col gap-1 overflow-y-auto">
          <li v-for="entry in visibleEntries" :key="entry.path">
            <button
              type="button"
              class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-elevated"
              @click="onEntryClick(entry)"
            >
              <UIcon
                :name="entry.dir ? 'i-lucide-folder' : 'i-lucide-file-lock-2'"
                class="size-5 shrink-0"
                :class="entry.dir ? 'text-warning' : 'text-primary'"
              />
              <span class="truncate">{{ entry.name }}</span>
              <UIcon
                v-if="entry.dir"
                name="i-lucide-chevron-right"
                class="ml-auto size-4 text-dimmed"
              />
            </button>
          </li>
        </ul>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full items-center justify-between gap-2">
        <UButton
          v-if="selectedProvider"
          color="neutral"
          variant="ghost"
          icon="i-lucide-arrow-left"
          :label="t('openProviders')"
          @click="backToProviders"
        />
        <span v-else />
        <UButton color="neutral" variant="ghost" :label="t('alertCancel')" @click="open = false" />
      </div>
    </template>
  </UModal>
</template>
