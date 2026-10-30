<script setup lang="ts">
// The live code beside an entry in the list: one tap copies it, without
// opening the entry.
import { t } from '@/i18n';
import { useOtpCode, useOtpActions } from '@/composables/useOtp';
import { formatOtpCode } from '@/domain/otp';
import type { EntryVm } from '@/types';
import OtpRing from '@/components/otp/OtpRing.vue';

const props = defineProps<{ entry: EntryVm }>();

const { copyOtp, otpOf } = useOtpActions();
const { params, code, timeLeft, fraction } = useOtpCode(() => otpOf(props.entry));
</script>

<template>
  <button
    v-if="params"
    type="button"
    class="flex items-center gap-1.5 rounded-md px-2 py-1 max-md:py-2 font-mono text-sm tabular-nums text-default bg-elevated/70 hover:bg-accented/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    :aria-label="`${t('detMenuCopyOtp')}: ${code}`"
    :title="t('otpTapToCopy')"
    data-testid="otp-chip"
    @click.stop="copyOtp(entry)"
    @keydown.enter.stop
  >
    {{ formatOtpCode(code) || '······' }}
    <OtpRing v-if="params.type === 'totp'" :fraction="fraction" :seconds="timeLeft" :size="14" />
    <UIcon v-else name="i-lucide-hash" class="size-3.5 text-muted" />
  </button>
  <UIcon v-else name="i-lucide-clock" class="size-4 text-muted" />
</template>
