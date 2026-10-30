<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import { t } from '@/i18n';
import { useVaultStore } from '@/stores/vault';
import { useOtpCode, useOtpActions } from '@/composables/useOtp';
import { formatOtpCode } from '@/domain/otp';
import type { EntryVm } from '@/types';
import EntryIcon from '@/components/shared/EntryIcon.vue';
import OtpRing from '@/components/otp/OtpRing.vue';

const props = defineProps<{ entry: EntryVm }>();

const vault = useVaultStore();
const { copyOtp, otpOf } = useOtpActions();
const { params, code, timeLeft, fraction, invalid } = useOtpCode(() => otpOf(props.entry));

const name = computed(() => props.entry.title || params.value?.issuer || t('noTitle'));
const account = computed(() => props.entry.username || params.value?.account || '');

// brief "Copied" on the row itself: the toast can be off-screen on a phone
const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
async function onCopy(): Promise<void> {
  if (!(await copyOtp(props.entry))) return;
  copied.value = true;
  clearTimeout(timer);
  timer = setTimeout(() => (copied.value = false), 1500);
}
onUnmounted(() => clearTimeout(timer));
</script>

<template>
  <li class="flex items-stretch border-b border-default" :class="entry.id === vault.selectedEntryId ? 'bg-primary/10' : ''">
    <button
      type="button"
      class="flex-1 min-w-0 flex items-center gap-3 pl-3 pr-1 py-2.5 text-left hover:bg-elevated/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
      :aria-label="`${t('detMenuCopyOtp')}: ${name}`"
      data-testid="otp-row"
      @click="onCopy"
    >
      <EntryIcon :icon="entry.icon" :color="entry.color" size="1.5rem" />
      <span class="flex-1 min-w-0">
        <span class="block truncate font-semibold text-highlighted">{{ name }}</span>
        <span class="block truncate text-sm text-muted">{{ account || '\u00A0' }}</span>
      </span>
      <span v-if="copied" class="flex items-center gap-1 text-sm font-medium text-success" role="status">
        <UIcon name="i-lucide-check" class="size-4" />{{ t('otpCopied') }}
      </span>
      <span v-else-if="invalid" class="text-xs text-error">{{ t('detOtpInvalid') }}</span>
      <span
        v-else
        class="font-mono text-xl font-semibold tabular-nums tracking-wide"
        :class="params?.type === 'totp' && timeLeft <= 5 ? 'text-warning' : 'text-default'"
      >
        {{ formatOtpCode(code) || '––– –––' }}
      </span>
      <OtpRing v-if="params?.type === 'totp'" :fraction="fraction" :seconds="timeLeft" :size="20" />
    </button>
    <UButton
      color="neutral"
      variant="ghost"
      icon="i-lucide-chevron-right"
      class="self-center mr-1"
      :aria-label="t('otpOpenEntry')"
      @click="vault.selectEntry(entry.id)"
    />
  </li>
</template>
