<script setup lang="ts">
/**
 * Yes/no confirmation dialog. The body text goes in `description` or the
 * default slot; confirming emits `confirm` and closes the dialog.
 */
import { t } from '@/i18n';

withDefaults(
  defineProps<{
    title: string;
    confirmLabel: string;
    description?: string;
    color?: 'error' | 'primary';
  }>(),
  { description: '', color: 'error' }
);

const open = defineModel<boolean>('open', { default: false });

const emit = defineEmits<{ confirm: [] }>();

function confirm(): void {
  emit('confirm');
  open.value = false;
}
</script>

<template>
  <UModal v-model:open="open" :title="title">
    <template #body>
      <p class="text-sm text-muted">
        <slot>{{ description }}</slot>
      </p>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton color="neutral" variant="ghost" :label="t('alertCancel')" @click="open = false" />
        <UButton :color="color" :label="confirmLabel" @click="confirm" />
      </div>
    </template>
  </UModal>
</template>
