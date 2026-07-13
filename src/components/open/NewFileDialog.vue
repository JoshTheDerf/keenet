<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { t } from '@/i18n';
import MasterPasswordField from './MasterPasswordField.vue';

const open = defineModel<boolean>('open', { default: false });

const emit = defineEmits<{ submit: [payload: { name: string; password: string }] }>();

const name = ref(t('openDefaultDbName'));
const password = ref('');
const confirm = ref('');

const passwordsMatch = computed(() => password.value === confirm.value);
const canSubmit = computed(() => name.value.trim().length > 0 && passwordsMatch.value);

watch(open, (isOpen) => {
  if (isOpen) {
    name.value = t('openDefaultDbName');
    password.value = '';
    confirm.value = '';
  }
});

function submit(): void {
  if (!canSubmit.value) return;
  emit('submit', { name: name.value.trim(), password: password.value });
}
</script>

<template>
  <UModal v-model:open="open" :title="t('openNewDatabase')">
    <template #body>
      <div class="flex flex-col gap-4">
        <UFormField :label="t('name')" required>
          <UInput v-model="name" size="lg" :ui="{ root: 'w-full' }" autofocus />
        </UFormField>

        <UFormField :label="t('setFilePass')">
          <MasterPasswordField v-model="password" @enter="submit" />
        </UFormField>

        <UFormField
          :label="t('setFileConfirmPass')"
          :error="confirm.length > 0 && !passwordsMatch ? t('setFilePassNotMatch') : undefined"
        >
          <MasterPasswordField v-model="confirm" @enter="submit" />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton color="neutral" variant="ghost" :label="t('alertCancel')" @click="open = false" />
        <UButton
          color="primary"
          icon="i-lucide-plus"
:label="t('create')"
          :disabled="!canSubmit"
          @click="submit"
        />
      </div>
    </template>
  </UModal>
</template>
