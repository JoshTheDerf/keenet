<script setup lang="ts">
/**
 * Small single-input prompt dialog — replaces window.prompt(), which is
 * unreliable in Electron and on mobile. Emits `confirm` with the trimmed
 * value; closes itself on confirm or cancel.
 */
import { ref, watch } from 'vue';
import { t } from '@/i18n';

const props = withDefaults(
  defineProps<{
    title: string;
    placeholder?: string;
    initial?: string;
    confirmLabel?: string;
    hint?: string;
  }>(),
  { placeholder: '', initial: '', confirmLabel: '', hint: '' }
);

const open = defineModel<boolean>('open', { default: false });

const emit = defineEmits<{ confirm: [value: string] }>();

const value = ref('');

watch(open, (isOpen) => {
  if (isOpen) value.value = props.initial;
});

function confirm(): void {
  const v = value.value.trim();
  if (!v) return;
  emit('confirm', v);
  open.value = false;
}
</script>

<template>
  <UModal v-model:open="open" :title="title">
    <template #body>
      <div class="flex flex-col gap-2">
        <UInput
          v-model="value"
          autofocus
          class="w-full"
          :placeholder="placeholder"
          @keyup.enter="confirm"
        />
        <p v-if="hint" class="text-xs text-muted">{{ hint }}</p>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton color="neutral" variant="ghost" :label="t('alertCancel')" @click="open = false" />
        <UButton
          color="primary"
          :label="confirmLabel || t('alertOk')"
          :disabled="!value.trim()"
          @click="confirm"
        />
      </div>
    </template>
  </UModal>
</template>
