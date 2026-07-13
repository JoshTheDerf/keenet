<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { t } from '@/i18n';
import { useSettingsStore } from '@/stores/settings';
import { useUiStore } from '@/stores/ui';
import { PROVIDERS } from '@/storage';
import { chooseFolder, hasFolder, fileSystemProvider, supportsFileSystemAccess } from '@/storage/filesystem';

const settings = useSettingsStore();
const ui = useUiStore();

// Sign-in state per oauth provider (isAuthorized() isn't reactive).
const authState = reactive<Record<string, boolean>>({});
const folderConnected = ref(false);
const fsSupported = supportsFileSystemAccess();

function refreshAuth(): void {
  for (const p of PROVIDERS) {
    if (p.oauth) authState[p.type] = p.isAuthorized?.() ?? false;
  }
}

async function refreshFolder(): Promise<void> {
  folderConnected.value = await hasFolder();
}

onMounted(() => {
  // Ensure a persisted enable flag exists for every provider (default on).
  for (const p of PROVIDERS) {
    if (settings.storageEnabled[p.type] === undefined) settings.storageEnabled[p.type] = true;
  }
  refreshAuth();
  void refreshFolder();
});

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function signIn(type: string): Promise<void> {
  const p = PROVIDERS.find((x) => x.type === type);
  if (!p) return;
  try {
    await p.authorize?.();
    ui.notify(t('setStorageSignedIn', p.title), { color: 'success' });
  } catch (e) {
    ui.notify(t('setStorageSignInFailed', p.title), { color: 'error', description: errText(e) });
  } finally {
    refreshAuth();
  }
}

function signOut(type: string): void {
  const p = PROVIDERS.find((x) => x.type === type);
  if (!p) return;
  p.logout?.();
  ui.notify(t('setStorageSignedOut', p.title), { color: 'info' });
  refreshAuth();
}

async function onChooseFolder(): Promise<void> {
  try {
    const ok = await chooseFolder();
    if (ok) ui.notify(t('setStorageFolderGranted'), { color: 'success' });
    else ui.notify(t('setStorageNoFolderSelected'), { color: 'warning' });
  } catch (e) {
    ui.notify(t('setStorageFolderError'), { color: 'error', description: errText(e) });
  } finally {
    void refreshFolder();
  }
}

function onForgetFolder(): void {
  fileSystemProvider.logout?.();
  ui.notify(t('setStorageFolderForgotten'), { color: 'info' });
  void refreshFolder();
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div>
      <h1 class="text-xl font-semibold">{{ t('setStorageTitle') }}</h1>
      <p class="text-sm text-muted mt-1">{{ t('setStorageIntro') }}</p>
    </div>

    <UCard v-for="provider in PROVIDERS" :key="provider.type">
      <div class="flex items-start justify-between gap-4">
        <div class="flex items-start gap-3 min-w-0">
          <UIcon :name="provider.icon" class="text-xl text-muted mt-0.5 shrink-0" />
          <div class="min-w-0">
            <div class="text-sm font-medium">{{ provider.title }}</div>

            <!-- Local Folder -->
            <div v-if="provider.type === 'fsaccess'" class="text-xs text-muted mt-0.5">
              <template v-if="!fsSupported">
                {{ t('setStorageNotSupported') }}
              </template>
              <template v-else>
                {{ folderConnected ? t('setStorageFolderConnected') : t('setStorageNoFolder') }}
              </template>
            </div>

            <!-- OAuth providers -->
            <div v-else-if="provider.oauth" class="text-xs mt-0.5">
              <span :class="authState[provider.type] ? 'text-success' : 'text-muted'">
                {{ authState[provider.type] ? t('setStorageConnected') : t('setStorageNotSignedIn') }}
              </span>
            </div>

            <!-- WebDAV -->
            <div v-else-if="provider.type === 'webdav'" class="text-xs text-muted mt-0.5">
              {{ t('setStorageWebdavDesc') }}
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <template v-if="provider.type === 'fsaccess'">
            <UButton
              icon="i-lucide-folder-open"
              size="sm"
              variant="soft"
              :disabled="!fsSupported"
              :label="t('setStorageChooseFolder')"
              @click="onChooseFolder"
            />
            <UButton
              v-if="folderConnected"
              icon="i-lucide-x"
              size="sm"
              color="neutral"
              variant="ghost"
              :label="t('setStorageForget')"
              @click="onForgetFolder"
            />
          </template>

          <template v-else-if="provider.oauth">
            <UButton
              v-if="authState[provider.type]"
              icon="i-lucide-log-out"
              size="sm"
              color="neutral"
              variant="soft"
              :label="t('setStorageSignOut')"
              @click="signOut(provider.type)"
            />
            <UButton
              v-else
              icon="i-lucide-log-in"
              size="sm"
              variant="soft"
              :label="t('alertSignIn')"
              @click="signIn(provider.type)"
            />
          </template>

          <USwitch v-model="settings.storageEnabled[provider.type]" />
        </div>
      </div>

      <!-- WebDAV default credentials -->
      <div v-if="provider.type === 'webdav'" class="mt-4 flex flex-col gap-3 max-w-md">
        <UFormField :label="t('setStorageServerUrl')" :help="t('setStorageServerUrlHelp')">
          <UInput
            v-model="settings.webdav.url"
            type="url"
            placeholder="https://dav.example.com/remote.php/webdav/vault.kdbx"
            class="w-full"
          />
        </UFormField>
        <UFormField :label="t('openUser')">
          <UInput v-model="settings.webdav.user" class="w-full" />
        </UFormField>
        <UFormField :label="t('openPass')">
          <UInput v-model="settings.webdav.password" type="password" class="w-full" />
        </UFormField>
      </div>
    </UCard>

    <!-- Advanced: custom OAuth app keys -->
    <UCard>
      <template #header>
        <h2 class="text-base font-semibold">{{ t('setStorageOauthTitle') }}</h2>
      </template>
      <div class="flex flex-col gap-4">
        <UAlert
          icon="i-lucide-info"
          color="info"
          variant="subtle"
          :title="t('setStorageOauthAlertTitle')"
          :description="t('setStorageOauthAlertBody')"
        />
        <UFormField :label="t('dropboxAppKey')">
          <UInput v-model="settings.cloudKeys.dropboxAppKey" class="w-full max-w-md" />
        </UFormField>
        <UFormField :label="t('setStorageGdriveClientId')">
          <UInput v-model="settings.cloudKeys.gdriveClientId" class="w-full max-w-md" />
        </UFormField>
        <UFormField :label="t('setStorageOnedriveClientId')">
          <UInput v-model="settings.cloudKeys.onedriveClientId" class="w-full max-w-md" />
        </UFormField>
      </div>
    </UCard>
  </div>
</template>
