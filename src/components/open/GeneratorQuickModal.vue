<script setup lang="ts">
import { ref } from 'vue';
import { BUILTIN_PRESETS, generatePassword } from '@/domain/generator';
import { useClipboard } from '@/composables/useClipboard';
import { t } from '@/i18n';
import PasswordStrengthBar from '@/components/shared/PasswordStrengthBar.vue';

const open = defineModel<boolean>('open', { default: false });

const { copy } = useClipboard();
const preset = BUILTIN_PRESETS.find((p) => p.default) ?? BUILTIN_PRESETS[0];
const value = ref('');

function regenerate(): void {
  value.value = generatePassword(preset);
}

regenerate();
</script>

<template>
  <UModal v-model:open="open" :title="t('footerTitleGen')">
    <template #body>
      <div class="flex flex-col gap-3">
        <UInput
          :model-value="value"
          readonly
          size="lg"
          icon="i-lucide-key-round"
          :ui="{ root: 'w-full', base: 'font-mono' }"
        />
        <PasswordStrengthBar :password="value" />
        <div class="flex gap-2">
          <UButton
            color="neutral"
            variant="subtle"
            icon="i-lucide-refresh-cw"
            :label="t('genNewPass')"
            @click="regenerate"
          />
          <UButton
            color="primary"
            icon="i-lucide-copy"
            :label="t('alertCopy')"
            @click="copy(value, t('password'))"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
