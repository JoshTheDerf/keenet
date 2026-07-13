<script setup lang="ts">
import { ref } from 'vue';
import { t } from '@/i18n';

const model = defineModel<string>({ default: '' });

withDefaults(
  defineProps<{
    placeholder?: string;
    autofocus?: boolean;
  }>(),
  { placeholder: '', autofocus: false }
);

const emit = defineEmits<{ enter: [] }>();

const show = ref(false);
const capsLock = ref(false);

function checkCaps(e: KeyboardEvent): void {
  capsLock.value = typeof e.getModifierState === 'function' && e.getModifierState('CapsLock');
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <UInput
      v-model="model"
      :type="show ? 'text' : 'password'"
      :placeholder="placeholder"
      :autofocus="autofocus"
      autocomplete="new-password"
      icon="i-lucide-lock"
      size="lg"
      :ui="{ root: 'w-full' }"
      @keyup="checkCaps"
      @keydown="checkCaps"
      @keydown.enter="emit('enter')"
    >
      <template #trailing>
        <UButton
          :icon="show ? 'i-lucide-eye-off' : 'i-lucide-eye'"
          color="neutral"
          variant="link"
          size="sm"
          :aria-label="show ? t('genHidePass') : t('genShowPass')"
          tabindex="-1"
          @click="show = !show"
        />
      </template>
    </UInput>
    <p v-if="capsLock" class="flex items-center gap-1 text-xs text-warning">
      <UIcon name="i-lucide-triangle-alert" class="shrink-0" />
      {{ t('openCaps') }}
    </p>
  </div>
</template>
