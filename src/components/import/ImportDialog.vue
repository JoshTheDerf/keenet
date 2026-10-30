<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useVaultStore } from '@/stores/vault';
import { pickFileViaInput } from '@/storage/local';
import { parseCsv, guessMapping, rowsToEntries, type CsvMapping } from '@/domain/csv';
import { parseOtpImport, type ImportedToken } from '@/domain/otp-import';
import { useOverlays } from '@/composables/useOverlays';
import { t } from '@/i18n';

const open = defineModel<boolean>('open', { default: false });
const props = defineProps<{ fileId: string }>();

const vault = useVaultStore();

type Mode = 'csv' | 'kdbx' | 'otp';
const mode = ref<Mode>('csv');
const { importMode } = useOverlays();

const tabs = computed<{ label: string; value: Mode; icon: string; slot: Mode }[]>(() => [
  { label: t('importCsvFile'), value: 'csv', icon: 'i-lucide-file-spreadsheet', slot: 'csv' },
  { label: t('importKdbxFile'), value: 'kdbx', icon: 'i-lucide-database', slot: 'kdbx' },
  { label: t('otpImportTab'), value: 'otp', icon: 'i-lucide-timer', slot: 'otp' }
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

// ---- one-time codes (FreeOTP JSON / otpauth list) --------------------------

const otpFileName = ref<string | null>(null);
const otpTokens = ref<ImportedToken[]>([]);
const otpError = ref('');
const otpAttach = ref(true);

const otpPlan = computed(() => vault.planOtpImport(props.fileId, otpTokens.value, otpAttach.value));
const otpImportCount = computed(() => otpPlan.value.filter((p) => p.action !== 'skip').length);

async function pickOtp(): Promise<void> {
  const picked = await pickFileViaInput('.json,.txt,application/json,text/plain');
  if (!picked) return;
  otpFileName.value = picked.name;
  otpError.value = '';
  otpTokens.value = [];
  try {
    otpTokens.value = parseOtpImport(new TextDecoder().decode(picked.data));
  } catch {
    otpError.value = t('otpImportUnreadable');
  }
}

function importOtp(): void {
  if (!otpImportCount.value) return;
  vault.importOtp(props.fileId, otpTokens.value, otpAttach.value);
  open.value = false;
}

// ---- reset on open -------------------------------------------------------

watch(open, (isOpen) => {
  if (!isOpen) return;
  mode.value = importMode.value;
  importMode.value = 'csv';
  otpFileName.value = null;
  otpTokens.value = [];
  otpError.value = '';
  otpAttach.value = true;
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

        <!-- One-time codes (FreeOTP backup) -->
        <template #otp>
          <div class="flex flex-col gap-4 pt-2">
            <p class="text-sm text-muted">{{ t('otpImportHelp') }}</p>
            <div class="flex items-center gap-3">
              <UButton icon="i-lucide-upload" variant="soft" :label="t('otpImportChoose')" @click="pickOtp" />
              <span v-if="otpFileName" class="text-sm text-muted truncate">{{ otpFileName }}</span>
            </div>
            <UAlert v-if="otpError" color="error" variant="soft" icon="i-lucide-circle-alert" :title="otpError" />

            <template v-if="otpTokens.length">
              <UCheckbox v-model="otpAttach" :label="t('otpImportAttach')" :description="t('otpImportAttachHelp')" />
              <ul class="max-h-72 overflow-y-auto rounded-md ring ring-default divide-y divide-default text-sm">
                <li v-for="(step, i) in otpPlan" :key="i" class="flex items-center gap-3 px-3 py-2">
                  <UIcon name="i-lucide-timer" class="size-4 text-muted shrink-0" />
                  <span class="flex-1 min-w-0">
                    <span class="block truncate font-medium">{{ step.token.issuer || step.token.account || t('noTitle') }}</span>
                    <span v-if="step.token.issuer && step.token.account" class="block truncate text-xs text-muted">{{ step.token.account }}</span>
                  </span>
                  <UBadge v-if="step.action === 'new'" color="primary" variant="soft" size="sm" :label="t('otpPlanNew')" />
                  <UBadge v-else-if="step.action === 'attach'" color="success" variant="soft" size="sm" class="max-w-40 truncate" :label="t('otpPlanAttach', step.entryTitle || t('noTitle'))" />
                  <UBadge v-else color="neutral" variant="soft" size="sm" :label="t('otpPlanSkip')" />
                </li>
              </ul>
            </template>
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
          v-else-if="mode === 'otp'"
          color="primary"
          icon="i-lucide-download"
          :label="t('otpImportRun', otpImportCount)"
          :disabled="!otpImportCount"
          @click="importOtp"
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
