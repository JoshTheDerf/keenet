<script setup lang="ts">
// One field in the touch read view: the whole row copies its value; secrets
// stay masked until the eye is tapped.
import { ref, computed, onUnmounted } from 'vue';
import { t } from '@/i18n';
import { useClipboard } from '@/composables/useClipboard';

const props = withDefaults(
  defineProps<{
    label: string;
    value: string;
    icon?: string;
    /** hide the value until revealed (passwords, protected fields) */
    secret?: boolean;
    mono?: boolean;
  }>(),
  { icon: undefined, secret: false, mono: false }
);

const { copy } = useClipboard();
const revealed = ref(false);
const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

const shown = computed(() => (props.secret && !revealed.value ? '•'.repeat(Math.min(12, Math.max(8, props.value.length))) : props.value));

async function onCopy(): Promise<void> {
  await copy(props.value, props.label, { sensitive: props.secret });
  copied.value = true;
  clearTimeout(timer);
  timer = setTimeout(() => (copied.value = false), 1500);
}
onUnmounted(() => clearTimeout(timer));
</script>

<template>
  <div class="flex items-center gap-1 pr-1 rounded-2xl bg-elevated/50 hover:bg-elevated/80 active:bg-elevated transition-colors">
    <button
      type="button"
      class="flex-1 min-w-0 flex items-center gap-3 px-4 py-3 text-left rounded-2xl cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      :aria-label="t('detCopyField', label)"
      data-testid="read-row"
      @click="onCopy"
    >
      <UIcon v-if="icon" :name="icon" class="size-5 text-muted shrink-0" />
      <span class="flex-1 min-w-0">
        <span class="block text-sm text-muted first-letter:uppercase">{{ label }}</span>
        <span
          class="block truncate text-highlighted"
          :class="[mono || (secret && !revealed) ? 'font-mono tracking-wide' : '', secret && !revealed ? 'text-muted' : '']"
        >{{ shown }}</span>
      </span>
      <span v-if="copied" class="flex items-center gap-1 text-sm font-medium text-success shrink-0" role="status">
        <UIcon name="i-lucide-check" class="size-4" />{{ t('otpCopied') }}
      </span>
      <UIcon v-else name="i-lucide-copy" class="size-5 text-dimmed shrink-0" />
    </button>
    <UButton
      v-if="secret"
      color="neutral"
      variant="ghost"
      :icon="revealed ? 'i-lucide-eye-off' : 'i-lucide-eye'"
      :aria-label="revealed ? t('detHideField') : t('detRevealField')"
      @click="revealed = !revealed"
    />
    <slot name="actions" />
  </div>
</template>
