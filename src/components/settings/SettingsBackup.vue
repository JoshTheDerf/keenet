<script setup lang="ts">
import { onMounted, reactive } from 'vue';
import { t } from '@/i18n';
import { useSettingsStore } from '@/stores/settings';
import { useUiStore } from '@/stores/ui';
import { useVaultStore } from '@/stores/vault';
import { listBackups, restoreBackup, removeBackup, type BackupEntry } from '@/storage/backup';
import { downloadData } from '@/storage/local';
import type { FileVm } from '@/types';

const settings = useSettingsStore();
const ui = useUiStore();
const vault = useVaultStore();

const backups = reactive<Record<string, BackupEntry[]>>({});

const dateFmt = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
});

const backupCountItems: { label: string; value: number }[] = [
  { label: '5', value: 5 },
  { label: '10', value: 10 },
  { label: '20', value: 20 },
  { label: '50', value: 50 }
];

async function loadAll(): Promise<void> {
  for (const file of vault.files) {
    backups[file.id] = await listBackups(file.id);
  }
  for (const id of Object.keys(backups)) {
    if (!vault.files.some((f) => f.id === id)) delete backups[id];
  }
}

onMounted(() => void loadAll());

function fileStem(name: string): string {
  return name.toLowerCase().endsWith('.kdbx') ? name.slice(0, -5) : name;
}

function backupFileName(file: FileVm, time: number): string {
  const stamp = new Date(time).toISOString().replace(/[:.]/g, '-');
  return `${fileStem(file.name)}-${stamp}.kdbx`;
}

async function onDownload(file: FileVm, entry: BackupEntry): Promise<void> {
  try {
    const data = await restoreBackup(entry.key);
    if (!data) {
      ui.notify(t('setBackupNotFound'), { color: 'error' });
      return;
    }
    downloadData(backupFileName(file, entry.time), data);
  } catch (e) {
    ui.notify(t('setBackupDownloadError'), {
      color: 'error',
      description: e instanceof Error ? e.message : String(e)
    });
  }
}

async function onDelete(entry: BackupEntry): Promise<void> {
  await removeBackup(entry.key);
  await loadAll();
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <h1 class="text-xl font-semibold">{{ t('setFileBackups') }}</h1>

    <UCard>
      <div class="flex flex-col gap-5">
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="text-sm font-medium">{{ t('setBackupLocal') }}</div>
            <div class="text-xs text-muted">{{ t('setBackupLocalDesc') }}</div>
          </div>
          <USwitch v-model="settings.backupEnabled" />
        </div>

        <div>
          <label class="text-sm font-medium">{{ t('setBackupKeep') }}</label>
          <div class="text-xs text-muted mb-1">{{ t('setBackupKeepDesc') }}</div>
          <USelect
            v-model="settings.backupCount"
            :items="backupCountItems"
            :disabled="!settings.backupEnabled"
            class="w-40"
          />
        </div>

        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="text-sm font-medium">{{ t('setBackupToStorage') }}</div>
            <div class="text-xs text-muted">{{ t('setBackupToStorageDesc') }}</div>
          </div>
          <USwitch v-model="settings.backupStorage" />
        </div>

        <div>
          <label class="text-sm font-medium">{{ t('setFileBackupPath') }}</label>
          <div class="text-xs text-muted mb-1">
            {{ t('setBackupPathPlaceholders') }} <code>{name}</code>, <code>{date}</code>,
            <code>{time}</code>. {{ t('setBackupPathPrune') }}
          </div>
          <UInput
            v-model="settings.backupStoragePath"
            :disabled="!settings.backupStorage"
            placeholder="Backups/{name}.{date}-{time}.bak.kdbx"
            class="w-full font-mono"
            size="sm"
          />
        </div>

        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="text-sm font-medium">{{ t('setBackupSyncOnSave') }}</div>
            <div class="text-xs text-muted">{{ t('setBackupSyncOnSaveDesc') }}</div>
          </div>
          <USwitch v-model="settings.syncOnSave" />
        </div>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-base font-semibold">{{ t('setBackupStored') }}</h2>
          <UButton
            icon="i-lucide-refresh-cw"
            size="sm"
            color="neutral"
            variant="ghost"
            :label="t('refresh')"
            @click="loadAll"
          />
        </div>
      </template>

      <p v-if="!vault.hasFiles" class="text-sm text-muted">{{ t('extensionErrorNoOpenFiles') }}</p>

      <div v-else class="flex flex-col gap-6">
        <div v-for="file in vault.files" :key="file.id">
          <div class="text-sm font-medium mb-2 flex items-center gap-2">
            <UIcon name="i-lucide-database" class="text-muted shrink-0" />
            <span class="truncate">{{ file.name }}</span>
          </div>

          <p v-if="!(backups[file.id]?.length)" class="text-xs text-muted pl-6">
            {{ t('setBackupNoneYet') }}
          </p>

          <ul v-else class="flex flex-col divide-y divide-default/60 pl-6">
            <li
              v-for="entry in backups[file.id]"
              :key="entry.key"
              class="flex items-center justify-between gap-3 py-2"
            >
              <span class="text-sm">{{ dateFmt.format(entry.time) }}</span>
              <div class="flex items-center gap-1 shrink-0">
                <UButton
                  icon="i-lucide-download"
                  size="xs"
                  variant="ghost"
                  :label="t('download')"
                  @click="onDownload(file, entry)"
                />
                <UButton
                  icon="i-lucide-trash-2"
                  size="xs"
                  color="error"
                  variant="ghost"
                  :label="t('detDelEntry')"
                  @click="onDelete(entry)"
                />
              </div>
            </li>
          </ul>
        </div>
      </div>
    </UCard>
  </div>
</template>
