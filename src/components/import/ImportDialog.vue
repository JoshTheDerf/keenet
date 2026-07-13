<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useVaultStore } from '@/stores/vault';
import { pickFileViaInput } from '@/storage/local';
import { parseCsv, guessMapping, rowsToEntries, type CsvMapping } from '@/domain/csv';
import { t } from '@/i18n';

const open = defineModel<boolean>('open', { default: false });
const props = defineProps<{ fileId: string }>();

const vault = useVaultStore();

type Mode = 'csv' | 'kdbx';
const mode = ref<Mode>('csv');

const tabs = computed<{ label: string; value: Mode; icon: string; slot: Mode }[]>(() => [
  { label: t('importCsvFile'), value: 'csv', icon: 'i-lucide-file-spreadsheet', slot: 'csv' },
  { label: t('importKdbxFile'), value: 'kdbx', icon: 'i-lucide-database', slot: 'kdbx' }
]);

// ---- CSV state -----------------------------------------------------------

const CUSTOM = '__custom__';

/** First letter uppercased — several legacy keys are lowercase nouns. */
function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

const fieldOptions = computed<{ label: string; value: string }[]>(() => [
  { label: t('importIgnoreField'), value: '' },
  { label: capitalize(t('title')), value: 'Title' },
  { label: capitalize(t('user')), value: 'UserName' },
  { label: capitalize(t('password')), value: 'Password' },
  { label: 'URL', value: 'URL' },
  { label: capitalize(t('notes')), value: 'Notes' },
  { label: t('importCustomField'), value: CUSTOM }
]);

const csvFileName = ref<string | null>(null);
const rows = ref<string[][]>([]);
const hasHeader = ref(true);
/** Per-column selected target: '' (skip), std field, or CUSTOM. */
const columnTargets = ref<string[]>([]);
/** Per-column custom field name (used when target === CUSTOM). */
const customNames = ref<string[]>([]);

const columnCount = computed(() =>
  rows.value.reduce((max, r) => Math.max(max, r.length), 0)
);

function resolvedName(idx: number): string {
  const target = columnTargets.value[idx] ?? '';
  if (target === CUSTOM) return customNames.value[idx]?.trim() ?? '';
  return target;
}

const mapping = computed<CsvMapping>(() => {
  const m: CsvMapping = {};
  for (let i = 0; i < columnCount.value; i++) {
    const name = resolvedName(i);
    if (name) m[i] = name;
  }
  return m;
});

/** Header labels shown in the preview table, one per column. */
const previewHeaders = computed<string[]>(() => {
  const out: string[] = [];
  for (let i = 0; i < columnCount.value; i++) {
    out.push(resolvedName(i) || '—');
  }
  return out;
});

/** Up to 5 data rows (respecting the header checkbox). */
const previewRows = computed<string[][]>(() => {
  const data = hasHeader.value ? rows.value.slice(1) : rows.value;
  return data.slice(0, 5);
});

const csvEntryCount = computed(() => {
  const data = hasHeader.value ? rows.value.slice(1) : rows.value;
  return data.length;
});

const canImportCsv = computed(
  () => rows.value.length > 0 && Object.keys(mapping.value).length > 0
);

function seedMapping(): void {
  const header = rows.value[0] ?? [];
  const guessed = hasHeader.value ? guessMapping(header) : {};
  const targets: string[] = [];
  const customs: string[] = [];
  for (let i = 0; i < columnCount.value; i++) {
    targets.push(guessed[i] ?? '');
    customs.push('');
  }
  columnTargets.value = targets;
  customNames.value = customs;
}

async function pickCsv(): Promise<void> {
  const picked = await pickFileViaInput('.csv');
  if (!picked) return;
  csvFileName.value = picked.name;
  const text = new TextDecoder().decode(picked.data);
  rows.value = parseCsv(text);
  seedMapping();
}

// Re-seed guessed mapping when the "first row is header" toggle flips.
watch(hasHeader, () => {
  if (rows.value.length) seedMapping();
});

function importCsv(): void {
  if (!canImportCsv.value) return;
  const entries = rowsToEntries(rows.value, mapping.value, hasHeader.value);
  vault.importCsv(props.fileId, entries);
  open.value = false;
}

// ---- KeePass (.kdbx) state ----------------------------------------------

const kdbxFileName = ref<string | null>(null);
const kdbxData = ref<ArrayBuffer | null>(null);
const kdbxPassword = ref('');
const keyFileName = ref<string | null>(null);
const keyFileData = ref<ArrayBuffer | null>(null);
const kdbxBusy = ref(false);

const canImportKdbx = computed(() => kdbxData.value !== null && !kdbxBusy.value);

async function pickKdbx(): Promise<void> {
  const picked = await pickFileViaInput('.kdbx');
  if (!picked) return;
  kdbxFileName.value = picked.name;
  kdbxData.value = picked.data;
}

async function pickKeyFile(): Promise<void> {
  const picked = await pickFileViaInput('.key,.keyx');
  if (!picked) return;
  keyFileName.value = picked.name;
  keyFileData.value = picked.data;
}

function clearKeyFile(): void {
  keyFileName.value = null;
  keyFileData.value = null;
}

async function importKdbx(): Promise<void> {
  if (!kdbxData.value) return;
  kdbxBusy.value = true;
  try {
    const count = await vault.importDatabase(
      props.fileId,
      kdbxData.value,
      kdbxPassword.value === '' ? null : kdbxPassword.value,
      keyFileData.value
    );
    // The store toasts errors (e.g. wrong password) and returns 0 on failure;
    // only close on a successful import so the user can retry the password.
    if (count > 0) open.value = false;
  } finally {
    kdbxBusy.value = false;
  }
}

// ---- reset on open -------------------------------------------------------

watch(open, (isOpen) => {
  if (!isOpen) return;
  mode.value = 'csv';
  csvFileName.value = null;
  rows.value = [];
  hasHeader.value = true;
  columnTargets.value = [];
  customNames.value = [];
  kdbxFileName.value = null;
  kdbxData.value = null;
  kdbxPassword.value = '';
  keyFileName.value = null;
  keyFileData.value = null;
  kdbxBusy.value = false;
});
</script>

<template>
  <UModal v-model:open="open" :title="t('cmdImport')" :ui="{ content: 'max-w-2xl' }">
    <template #body>
      <UTabs v-model="mode" :items="tabs" class="w-full">
        <!-- CSV import -->
        <template #csv>
          <div class="flex flex-col gap-4 pt-2">
            <div class="flex items-center gap-3">
              <UButton
                icon="i-lucide-upload"
                variant="soft"
:label="t('importChooseCsv')"
                @click="pickCsv"
              />
              <span v-if="csvFileName" class="text-sm text-muted truncate">{{ csvFileName }}</span>
            </div>

            <template v-if="rows.length">
              <UCheckbox v-model="hasHeader" :label="t('importFirstRowHeader')" />

              <UFormField :label="t('importColumnMapping')" :help="t('importColumnMappingHelp')">
                <div class="flex flex-col gap-2">
                  <div
                    v-for="(_, idx) in columnCount"
                    :key="idx"
                    class="flex items-center gap-2"
                  >
                    <span class="text-xs text-muted w-28 truncate">
                      {{ hasHeader ? rows[0]?.[idx] || t('importColumn', idx + 1) : t('importColumn', idx + 1) }}
                    </span>
                    <USelect
                      v-model="columnTargets[idx]"
                      :items="fieldOptions"
                      class="w-40"
                    />
                    <UInput
                      v-if="columnTargets[idx] === CUSTOM"
                      v-model="customNames[idx]"
                      :placeholder="t('importFieldName')"
                      class="w-40"
                    />
                  </div>
                </div>
              </UFormField>

              <UFormField :label="t('preview')">
                <div class="overflow-x-auto rounded-md ring ring-default">
                  <table class="w-full text-xs">
                    <thead>
                      <tr class="border-b border-default bg-elevated/50">
                        <th
                          v-for="(h, i) in previewHeaders"
                          :key="i"
                          class="px-2 py-1 text-left font-medium whitespace-nowrap"
                        >
                          {{ h }}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="(row, r) in previewRows"
                        :key="r"
                        class="border-b border-default last:border-0"
                      >
                        <td
                          v-for="(_, c) in columnCount"
                          :key="c"
                          class="px-2 py-1 whitespace-nowrap truncate max-w-[12rem]"
                        >
                          {{ row[c] ?? '' }}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </UFormField>
            </template>

            <p v-else class="text-sm text-muted">{{ t('importChooseCsvHint') }}</p>
          </div>
        </template>

        <!-- KeePass file import -->
        <template #kdbx>
          <div class="flex flex-col gap-4 pt-2">
            <div class="flex items-center gap-3">
              <UButton
                icon="i-lucide-upload"
                variant="soft"
:label="t('importChooseKdbx')"
                @click="pickKdbx"
              />
              <span v-if="kdbxFileName" class="text-sm text-muted truncate">{{ kdbxFileName }}</span>
            </div>

            <UFormField :label="t('setFilePass')">
              <UInput
                v-model="kdbxPassword"
                type="password"
                class="w-full max-w-md"
                :placeholder="t('setFilePass')"
                @keyup.enter="canImportKdbx && importKdbx()"
              />
            </UFormField>

            <UFormField :label="t('setFileKeyFile')" :help="t('importKeyFileHelp')">
              <div class="flex flex-wrap items-center gap-2">
                <UButton
                  icon="i-lucide-file-key"
                  variant="soft"
:label="t('setFileSelKeyFile')"
                  @click="pickKeyFile"
                />
                <span v-if="keyFileName" class="text-sm text-muted truncate">{{ keyFileName }}</span>
                <UButton
                  v-if="keyFileName"
                  icon="i-lucide-x"
                  color="neutral"
                  variant="ghost"
                  @click="clearKeyFile"
                />
              </div>
            </UFormField>

            <UAlert
              icon="i-lucide-info"
              color="neutral"
              variant="subtle"
              :description="t('importMergeInfo')"
            />
          </div>
        </template>
      </UTabs>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton color="neutral" variant="ghost" :label="t('alertCancel')" @click="open = false" />
        <UButton
          v-if="mode === 'csv'"
          color="primary"
          icon="i-lucide-download"
          :label="t('importEntriesCount', csvEntryCount)"
          :disabled="!canImportCsv"
          @click="importCsv"
        />
        <UButton
          v-else
          color="primary"
          icon="i-lucide-download"
:label="t('importCsvRun')"
          :loading="kdbxBusy"
          :disabled="!canImportKdbx"
          @click="importKdbx"
        />
      </div>
    </template>
  </UModal>
</template>
