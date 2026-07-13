<script setup lang="ts">
import { ref, computed } from 'vue';
import { t } from '@/i18n';
import { useVaultStore } from '@/stores/vault';
import { useClipboard } from '@/composables/useClipboard';
import { isDesktop } from '@/composables/useDesktop';
import {
  runAutoType,
  sequenceToText,
  DEFAULT_SEQUENCE,
  type AutoTypeContext
} from '@/domain/auto-type';
import type { EntryVm } from '@/types';

const props = defineProps<{ entry: EntryVm }>();

const vault = useVaultStore();
const { copy } = useClipboard();

const open = ref(false);
const sequence = ref(props.entry.autoType.sequence ?? '');

const effectiveSeq = computed(() =>
  vault.getEffectiveAutoTypeSeq(props.entry.fileId, props.entry.id) || DEFAULT_SEQUENCE
);

const desktop = isDesktop();

function setEnabled(enabled: boolean): void {
  vault.setAutoType(props.entry.fileId, props.entry.id, { enabled });
}

function setObfuscation(obfuscation: boolean): void {
  vault.setAutoType(props.entry.fileId, props.entry.id, { obfuscation });
}

function commitSequence(): void {
  vault.setAutoType(props.entry.fileId, props.entry.id, { sequence: sequence.value.trim() });
}

function buildContext(): AutoTypeContext {
  const e = props.entry;
  const fileId = e.fileId;
  const fields: Record<string, string> = {};
  for (const f of e.fields) fields[f.name] = vault.resolveReference(fileId, f.value);
  return {
    title: e.title,
    username: vault.resolveReference(fileId, e.username),
    password: vault.resolveReference(fileId, e.password),
    url: vault.resolveReference(fileId, e.url),
    notes: e.notes,
    totp: '',
    fields
  };
}

async function run(): Promise<void> {
  await runAutoType(effectiveSeq.value, buildContext());
}

function copySequence(): void {
  void copy(sequenceToText(effectiveSeq.value, buildContext()), t('detAutoType'));
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <button
      type="button"
      class="flex items-center gap-1.5 text-sm font-medium text-muted hover:text-default"
      @click="open = !open"
    >
      <UIcon :name="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-4" />
      <UIcon name="i-lucide-keyboard" class="size-4" />
      <span>{{ t('detAutoType') }}</span>
    </button>

    <div v-if="open" class="flex flex-col gap-3 pl-6">
      <USwitch
        :model-value="entry.autoType.enabled"
        :label="t('detAutoTypeEnabled')"
        @update:model-value="setEnabled"
      />
      <USwitch
        :model-value="entry.autoType.obfuscation"
        :label="t('detAutoTypeObfuscation')"
        @update:model-value="setObfuscation"
      />

      <UFormField :label="t('detAutoTypeSequence')">
        <UInput
          v-model="sequence"
          :placeholder="effectiveSeq"
          autocomplete="off"
          spellcheck="false"
          class="w-full font-mono"
          @blur="commitSequence"
          @keydown.enter="commitSequence"
        />
      </UFormField>

      <div class="flex flex-wrap items-center gap-2">
        <UButton color="primary" variant="soft" size="sm" icon="i-lucide-play" @click="run">
          {{ t('detAutoTypeRun') }}
        </UButton>
        <UButton
          v-if="!desktop"
          color="neutral"
          variant="soft"
          size="sm"
          icon="i-lucide-copy"
          @click="copySequence"
        >
          {{ t('detAutoTypeCopySeq') }}
        </UButton>
      </div>

      <UAlert
        v-if="!desktop"
        color="info"
        variant="soft"
        icon="i-lucide-info"
:title="t('detAutoTypeWebLimited')"
        :description="t('detAutoTypeWebLimitedBody')"
      />

      <div v-if="entry.autoType.items.length" class="flex flex-col gap-1">
        <span class="text-xs font-medium text-muted">{{ t('detAutoTypeWindow') }}</span>
        <div
          v-for="(item, index) in entry.autoType.items"
          :key="index"
          class="flex flex-col gap-0.5 rounded-md px-2 py-1 text-xs ring ring-default"
        >
          <span class="truncate font-medium">{{ item.window }}</span>
          <span class="truncate font-mono text-muted">{{ item.sequence }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
