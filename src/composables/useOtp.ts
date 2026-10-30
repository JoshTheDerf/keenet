/**
 * Live one-time codes. Every visible code shares one 1-second clock, and a
 * code is only recomputed when its time step (or HOTP counter) changes.
 */
import { computed, onScopeDispose, ref, watch } from 'vue';
import { computeOtp, otpCounter, totpTimeLeft, tryParseOtp, type OtpParams } from '@/domain/otp';
import { useVaultStore } from '@/stores/vault';
import { useClipboard } from '@/composables/useClipboard';
import { t } from '@/i18n';
import type { EntryVm } from '@/types';

const now = ref(Date.now());
let subscribers = 0;
let clock: ReturnType<typeof setInterval> | undefined;

function subscribe(): void {
  if (subscribers++ === 0) {
    now.value = Date.now();
    clock = setInterval(() => (now.value = Date.now()), 1000);
  }
}

function unsubscribe(): void {
  if (--subscribers === 0 && clock) {
    clearInterval(clock);
    clock = undefined;
  }
}

/** The current code for an OTP value (otpauth URI / secret), kept up to date. */
export function useOtpCode(source: () => string | undefined) {
  subscribe();
  onScopeDispose(unsubscribe);

  const params = computed<OtpParams | null>(() => tryParseOtp(source()));
  const counter = computed(() => (params.value ? otpCounter(params.value, now.value) : -1));
  const timeLeft = computed(() =>
    params.value?.type === 'totp' ? totpTimeLeft(params.value.period, now.value) : 0
  );
  /** 0..1 of the current window still left (1 for HOTP) */
  const fraction = computed(() =>
    params.value?.type === 'totp' ? timeLeft.value / params.value.period : 1
  );
  const code = ref('');

  watch(
    [params, counter],
    async ([p, c], _old, onCleanup) => {
      let stale = false;
      onCleanup(() => (stale = true));
      if (!p) {
        code.value = '';
        return;
      }
      // compute for the step the counter names, not "now", so the two never disagree
      const value = await computeOtp(p, p.type === 'totp' ? c * p.period * 1000 : undefined);
      if (!stale) code.value = value;
    },
    { immediate: true }
  );

  return { params, code, timeLeft, fraction, invalid: computed(() => !!source() && !params.value) };
}

/** Copy an entry's current code (and move an HOTP counter on, since each code is single-use). */
export function useOtpActions() {
  const vault = useVaultStore();
  const { copy } = useClipboard();

  function otpOf(entry: EntryVm): string | undefined {
    return entry.otp ? vault.resolveReference(entry.fileId, entry.otp) : undefined;
  }

  async function copyOtp(entry: EntryVm): Promise<boolean> {
    const p = tryParseOtp(otpOf(entry));
    if (!p) return false;
    const code = await computeOtp(p);
    await copy(code, entry.title ? t('otpCopiedFor', entry.title) : t('detOtpField'));
    if (p.type === 'hotp') vault.advanceHotp(entry.fileId, entry.id);
    return true;
  }

  /** The current code for auto-type's {TOTP} placeholder. */
  async function currentCode(entry: EntryVm): Promise<string> {
    const p = tryParseOtp(otpOf(entry));
    return p ? computeOtp(p) : '';
  }

  return { copyOtp, currentCode, otpOf };
}
