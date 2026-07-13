<script setup lang="ts">
import { ref, watch, reactive } from 'vue';
import { t } from '@/i18n';
import { useVaultStore } from '@/stores/vault';
import { useClipboard } from '@/composables/useClipboard';
import type { FieldVm } from '@/types';
import TextPromptModal from '@/components/shared/TextPromptModal.vue';

const props = defineProps<{ fileId: string; entryId: string; fields: FieldVm[] }>();

const vault = useVaultStore();
const { copy } = useClipboard();

const local = ref<FieldVm[]>(props.fields.map((f) => ({ ...f })));
const revealed = reactive<Record<string, boolean>>({});

watch(
  () => props.fields,
  (fields) => {
    local.value = fields.map((f) => ({ ...f }));
  },
  { deep: true }
);

function commitValue(index: number): void {
  const original = props.fields[index];
  const edited = local.value[index];
  if (!original || !edited) return;
  if (edited.value !== original.value) {
    vault.updateField(props.fileId, props.entryId, original.name, edited.value, original.protected);
  }
}

function commitName(index: number): void {
  const original = props.fields[index];
  const edited = local.value[index];
  if (!original || !edited) return;
  const newName = edited.name.trim();
  if (newName && newName !== original.name) {
    vault.renameField(props.fileId, props.entryId, original.name, newName);
  } else {
    edited.name = original.name;
  }
}

function toggleProtected(index: number): void {
  const field = props.fields[index];
  if (!field) return;
  vault.updateField(props.fileId, props.entryId, field.name, field.value, !field.protected);
}

function remove(index: number): void {
  const field = props.fields[index];
  if (field) vault.removeField(props.fileId, props.entryId, field.name);
}

const addOpen = ref(false);

function confirmAddField(name: string): void {
  if (props.fields.some((f) => f.name === name)) return;
  vault.updateField(props.fileId, props.entryId, name, '');
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div v-for="(field, index) in local" :key="index" class="flex flex-col gap-1">
      <div class="flex items-center gap-1.5">
        <UInput
          v-model="field.name"
          size="sm"
          class="w-40"
          :placeholder="t('name')"
          @blur="commitName(index)"
          @keydown.enter="commitName(index)"
        />
        <span class="text-xs text-muted">field</span>
      </div>
      <div class="flex items-center gap-1.5">
        <UInput
          v-model="field.value"
          :type="field.protected && !revealed[field.name] ? 'password' : 'text'"
          class="flex-1 min-w-0"
          autocomplete="off"
          spellcheck="false"
          @blur="commitValue(index)"
        />
        <UTooltip v-if="field.protected" :text="revealed[field.name] ? t('detHideField') : t('detRevealField')">
          <UButton
            color="neutral"
            variant="ghost"
            :icon="revealed[field.name] ? 'i-lucide-eye-off' : 'i-lucide-eye'"
            :aria-label="t('detRevealField')"
            @click="revealed[field.name] = !revealed[field.name]"
          />
        </UTooltip>
        <UTooltip :text="field.protected ? t('detUnlockField') : t('detLockField')">
          <UButton
            color="neutral"
            variant="ghost"
            :icon="field.protected ? 'i-lucide-lock' : 'i-lucide-lock-open'"
            :aria-label="t('detToggleProtect')"
            @click="toggleProtected(index)"
          />
        </UTooltip>
        <UTooltip :text="t('alertCopy')">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-copy"
            :aria-label="t('alertCopy')"
            @click="copy(field.value, field.name, { sensitive: field.protected })"
          />
        </UTooltip>
        <UTooltip :text="t('remove')">
          <UButton
            color="error"
            variant="ghost"
            icon="i-lucide-trash-2"
            :aria-label="t('remove')"
            @click="remove(index)"
          />
        </UTooltip>
      </div>
    </div>

    <div>
      <UButton
        color="neutral"
        variant="soft"
        icon="i-lucide-plus"
        size="sm"
        @click="addOpen = true"
      >
        {{ t('detMenuAddNewField') }}
      </UButton>
    </div>

    <TextPromptModal
      v-model:open="addOpen"
      :title="t('detMenuAddNewField')"
      :placeholder="t('name')"
      @confirm="confirmAddField"
    />
  </div>
</template>
