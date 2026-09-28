<script setup lang="ts">
/**
 * The password generator in a dialog. Emits `select` with the chosen password
 * and closes; what "select" means (copy it, fill a field) is up to the parent.
 */
import { t } from '@/i18n';
import GeneratorPanel from './GeneratorPanel.vue';

withDefaults(defineProps<{ title?: string; selectLabel?: string }>(), {
  title: '',
  selectLabel: ''
});

const open = defineModel<boolean>('open', { default: false });

const emit = defineEmits<{ select: [password: string] }>();

function onSelect(pw: string): void {
  emit('select', pw);
  open.value = false;
}
</script>

<template>
  <UModal v-model:open="open" :title="title || t('cmdGeneratePassword')">
    <template #body>
      <GeneratorPanel :select-label="selectLabel" @select="onSelect" @close="open = false" />
    </template>
  </UModal>
</template>
