<script setup lang="ts">
import { computed, reactive, ref, useTemplateRef, watchEffect } from 'vue';
import { useVaultStore } from '@/stores/vault';
import { useUiStore } from '@/stores/ui';
import { pickFileViaInput, downloadData } from '@/storage/local';
import { t } from '@/i18n';
import type { FileVm } from '@/types';
import ImportDialog from '@/components/import/ImportDialog.vue';
import CloseFileConfirm from '@/components/shared/CloseFileConfirm.vue';
import { errorMessage } from '@/components/shared/format';
import SettingRow from './SettingRow.vue';

const vault = useVaultStore();
const ui = useUiStore();

// A single import dialog instance, retargeted per file.
const importOpen = ref(false);
const importFileId = ref('');

function onImport(file: FileVm): void {
  importFileId.value = file.id;
  importOpen.value = true;
}

/** Drafts for the text inputs (committed on change) and the password form. */
interface FileForm {
  name: string;
  defaultUser: string;
  password: string;
  confirmPassword: string;
  allowEmpty: boolean;
  busy: boolean;
}

const forms = reactive<Record<string, FileForm>>({});

watchEffect(() => {
  const seen = new Set<string>();
  for (const file of vault.files) {
    seen.add(file.id);
    if (!forms[file.id]) {
      forms[file.id] = {
        name: file.name,
        defaultUser: file.defaultUser,
        password: '',
        confirmPassword: '',
        allowEmpty: false,
        busy: false
      };
    }
  }
  // Drop state for closed files.
  for (const id of Object.keys(forms)) if (!seen.has(id)) delete forms[id];
});

const HISTORY_STEPS = [10, 20, 50, 100];

/** History choices, plus the file's current value when it isn't a preset step. */
function historyItems(file: FileVm): { label: string; value: number }[] {
  const steps = HISTORY_STEPS.includes(file.historyMaxItems) || file.historyMaxItems <= 0
    ? HISTORY_STEPS
    : [...HISTORY_STEPS, file.historyMaxItems].sort((a, b) => a - b);
  return [
    { label: t('setFileHistDisabled'), value: 0 },
    ...steps.map((n) => ({ label: `${n} ${t('detHistoryRecs')}`, value: n }))
  ];
}

const formatItems = computed<{ label: string; value: string }[]>(() => [
  { label: 'KDBX 3.1', value: '3.1' },
  { label: 'KDBX 4.0', value: '4.0' },
  { label: `KDBX 4.1 (${t('setFileLatestSuffix')})`, value: '4.1' }
]);

const kdfItems: { label: string; value: string }[] = [
  { label: 'Argon2id', value: 'Argon2id' },
  { label: 'Argon2d', value: 'Argon2d' },
  { label: 'AES-KDF', value: 'AES' }
];

function onName(file: FileVm): void {
  vault.setFileName(file.id, forms[file.id].name.trim() || file.name);
}

function onDefaultUser(file: FileVm): void {
  vault.setDefaultUser(file.id, forms[file.id].defaultUser);
}

async function onApplyPassword(file: FileVm): Promise<void> {
  const form = forms[file.id];
  if (form.password !== form.confirmPassword) {
    ui.notify(t('setFilePassNotMatch'), { color: 'error' });
    return;
  }
  if (form.password === '' && !form.allowEmpty) {
    ui.notify(t('setFileEmptyPass'), { color: 'error', description: t('setFileEmptyPassBody') });
    return;
  }
  form.busy = true;
  try {
    await vault.changePassword(file.id, form.password === '' ? null : form.password);
    ui.notify(t('setFilePassChanged'), { color: 'success', description: file.name });
    form.password = '';
    form.confirmPassword = '';
    form.allowEmpty = false;
  } catch (e) {
    ui.notify(t('setFilePassChangeError'), {
      color: 'error',
      description: errorMessage(e)
    });
  } finally {
    form.busy = false;
  }
}

async function onSetKeyFile(file: FileVm): Promise<void> {
  const picked = await pickFileViaInput('.key,.keyx');
  if (!picked) return;
  try {
    await vault.changeKeyFile(file.id, picked.data, picked.name);
    ui.notify(t('setFileKeyFileSet'), { color: 'success', description: picked.name });
  } catch (e) {
    ui.notify(t('setFileKeyFileSetError'), {
      color: 'error',
      description: errorMessage(e)
    });
  }
}

async function onGenerateKeyFile(file: FileVm): Promise<void> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const name = `${file.name.replace(/\.kdbx$/i, '')}.key`;
  try {
    await vault.changeKeyFile(file.id, bytes.buffer, name);
    downloadData(name, bytes);
    ui.notify(t('setFileKeyFileGenerated'), {
      color: 'success',
      description: t('setFileKeyFileGeneratedBody')
    });
  } catch (e) {
    ui.notify(t('setFileKeyFileGenError'), {
      color: 'error',
      description: errorMessage(e)
    });
  }
}

async function onRemoveKeyFile(file: FileVm): Promise<void> {
  try {
    await vault.changeKeyFile(file.id, null);
    ui.notify(t('setFileKeyFileRemoved'), { color: 'success', description: file.name });
  } catch (e) {
    ui.notify(t('setFileKeyFileRemoveError'), {
      color: 'error',
      description: errorMessage(e)
    });
  }
}

function onHistory(file: FileVm, value: number): void {
  vault.setHistoryMaxItems(file.id, value);
}

function onRecycleBin(file: FileVm, value: boolean): void {
  vault.setRecycleBinEnabled(file.id, value);
}

function onFormat(file: FileVm, value: string): void {
  if (value === '3.1') vault.setFormatVersion(file.id, 3);
  else if (value === '4.0') vault.setFormatVersion(file.id, 4, 0);
  else vault.setFormatVersion(file.id, 4, 1);
}

function onUpgradeFormat(file: FileVm): void {
  vault.upgradeFormat(file.id);
}

async function onExportXml(file: FileVm): Promise<void> {
  const xml = await vault.exportXml(file.id);
  if (xml) downloadData(`${file.name}.xml`, new TextEncoder().encode(xml), 'application/xml');
}

function onExportHtml(file: FileVm): void {
  const html = vault.exportHtml(file.id);
  if (html) downloadData(`${file.name}.html`, new TextEncoder().encode(html), 'text/html');
}

function onKdf(file: FileVm, value: string): void {
  vault.setKdf(file.id, value);
}

async function onSave(file: FileVm): Promise<void> {
  forms[file.id].busy = true;
  try {
    await vault.persistFile(file.id);
  } finally {
    forms[file.id].busy = false;
  }
}

async function onSync(file: FileVm): Promise<void> {
  forms[file.id].busy = true;
  try {
    await vault.syncFile(file.id);
  } finally {
    forms[file.id].busy = false;
  }
}

const closer = useTemplateRef<InstanceType<typeof CloseFileConfirm>>('closer');
</script>

<template>
  <div class="flex flex-col gap-6">
    <h1 class="text-xl font-semibold">{{ t('setFilesTitle') }}</h1>

    <div v-if="!vault.hasFiles" class="flex flex-col items-start gap-3">
      <p class="text-sm text-muted">{{ t('extensionErrorNoOpenFiles') }}</p>
      <UButton
        icon="i-lucide-folder-open"
        :label="t('cmdOpenDatabase')"
        @click="ui.showScreen('open')"
      />
    </div>

    <UCard v-for="file in vault.files" :key="file.id">
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div class="flex items-center gap-2 min-w-0">
            <UIcon name="i-lucide-database" class="shrink-0 text-muted" />
            <span class="font-medium truncate">{{ file.name }}</span>
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            <UBadge color="neutral" variant="subtle" class="capitalize" :label="file.storage" />
            <UBadge color="neutral" variant="subtle" :label="`KDBX ${file.formatVersion}`" />
            <UBadge v-if="file.kdf" color="neutral" variant="subtle" :label="file.kdf" />
            <UBadge color="neutral" variant="subtle" :label="t('setFileEntriesCount', file.entryCount)" />
            <UBadge v-if="file.modified" color="warning" variant="subtle" :label="t('unsaved')" />
            <UBadge v-if="file.readOnly" color="neutral" variant="subtle" :label="t('readOnly')" />
          </div>
        </div>
      </template>

      <div v-if="forms[file.id]" class="flex flex-col gap-5">
        <!-- Name -->
        <UFormField :label="t('setFileNames')">
          <UInput v-model="forms[file.id].name" class="w-full max-w-md" @change="onName(file)" />
        </UFormField>

        <!-- Default username -->
        <UFormField
          :label="t('setFileDefUser')"
          :help="t('setFileDefUserHelp')"
        >
          <UInput
            v-model="forms[file.id].defaultUser"
            class="w-full max-w-md"
            @change="onDefaultUser(file)"
          />
        </UFormField>

        <USeparator />

        <!-- Master password -->
        <UFormField :label="t('setFilePass')" :help="t('setFilePassChange')">
          <div class="flex flex-col gap-2 max-w-md">
            <UInput
              v-model="forms[file.id].password"
              type="password"
              :placeholder="t('setFilePass')"
            />
            <UInput
              v-model="forms[file.id].confirmPassword"
              type="password"
              :placeholder="t('setFileConfirmPass')"
            />
            <UCheckbox
              v-model="forms[file.id].allowEmpty"
              :label="t('setFileAllowEmptyPass')"
            />
            <div>
              <UButton
                icon="i-lucide-key-round"
                :loading="forms[file.id].busy"
                :label="t('setFileChangePassBtn')"
                @click="onApplyPassword(file)"
              />
            </div>
          </div>
        </UFormField>

        <USeparator />

        <!-- Key file -->
        <UFormField :label="t('setFileKeyFile')">
          <div class="flex flex-col gap-2">
            <div class="text-sm text-muted">
              {{ file.keyFileName ? file.keyFileName : t('setFileDontUseKeyFile') }}
            </div>
            <div class="flex flex-wrap gap-2">
              <UButton
                icon="i-lucide-file-key"
                variant="soft"
                :label="t('setFileSelKeyFile')"
                @click="onSetKeyFile(file)"
              />
              <UButton
                icon="i-lucide-wand-sparkles"
                variant="soft"
                :label="t('setFileGenKeyFile')"
                @click="onGenerateKeyFile(file)"
              />
              <UButton
                v-if="file.keyFileName"
                icon="i-lucide-trash-2"
                color="error"
                variant="soft"
                :label="t('setFileDontUseKeyFile')"
                @click="onRemoveKeyFile(file)"
              />
            </div>
          </div>
        </UFormField>

        <USeparator />

        <!-- History -->
        <UFormField :label="t('setFileHistMode')" :help="t('setFileHistLen')">
          <USelect
            :model-value="file.historyMaxItems"
            :items="historyItems(file)"
            class="w-64"
            @update:model-value="onHistory(file, $event)"
          />
        </UFormField>

        <!-- Recycle bin -->
        <SettingRow :label="t('setFileEnableTrash')" :help="t('setFileTrashHelp')">
          <USwitch
            :model-value="file.recycleBinEnabled"
            @update:model-value="onRecycleBin(file, $event)"
          />
        </SettingRow>

        <USeparator />

        <!-- Format / version -->
        <UFormField :label="t('setFileFormatVersion')" :help="t('setFileCurrentFormat', file.versionLabel)">
          <div class="flex flex-col gap-2">
            <USelect
              :model-value="file.versionLabel"
              :items="formatItems"
              class="w-64"
              @update:model-value="onFormat(file, $event)"
            />
            <div v-if="!file.isLatestFormat" class="flex items-center gap-2">
              <UButton
                icon="i-lucide-arrow-up-circle"
                color="primary"
                variant="soft"
                :label="t('setFileUpgradeFormat')"
                @click="onUpgradeFormat(file)"
              />
              <span class="text-xs text-muted">{{ t('setFileUpgradeFormatHelp') }}</span>
            </div>
          </div>
        </UFormField>

        <!-- KDF -->
        <UFormField :label="t('setFileKdfParams')">
          <USelect
            :model-value="file.kdf"
            :items="kdfItems"
            class="w-64"
            @update:model-value="onKdf(file, $event)"
          />
        </UFormField>

        <USeparator />

        <!-- Import / Export -->
        <UFormField :label="t('setFileImportExport')">
          <div class="flex flex-wrap gap-2">
            <UButton
              icon="i-lucide-file-input"
              variant="soft"
              :label="`${t('cmdImport')}…`"
              @click="onImport(file)"
            />
            <UButton
              icon="i-lucide-file-code"
              variant="soft"
              :label="`${t('cmdExport')} XML`"
              @click="onExportXml(file)"
            />
            <UButton
              icon="i-lucide-file-text"
              variant="soft"
              :label="`${t('cmdExport')} HTML`"
              @click="onExportHtml(file)"
            />
          </div>
        </UFormField>
      </div>

      <template #footer>
        <div class="flex flex-wrap items-center gap-2">
          <UButton
            icon="i-lucide-save"
            color="primary"
            :loading="forms[file.id]?.busy"
            :label="t('setFileSave')"
            @click="onSave(file)"
          />
          <UButton
            v-if="file.storage !== 'file'"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="soft"
            :loading="forms[file.id]?.busy"
            :label="t('setFileSync')"
            @click="onSync(file)"
          />
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="soft"
            :label="t('setFileClose')"
            @click="closer?.request(file.id)"
          />
        </div>
      </template>
    </UCard>

    <ImportDialog v-model:open="importOpen" :file-id="importFileId" />

    <CloseFileConfirm ref="closer" />
  </div>
</template>
