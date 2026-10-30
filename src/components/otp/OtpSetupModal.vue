<script setup lang="ts">
// Set up a one-time code: scan the site's QR code (camera, image or paste), or
// type the setup key the site shows under "can't scan?".
import { ref, computed, watch } from 'vue';
import { t } from '@/i18n';
import { buildOtpUri, isValidSecret, normalizeSecret, parseOtpUri, type OtpParams } from '@/domain/otp';
import type { ImportedToken } from '@/domain/otp-import';
import OtpScanner from '@/components/otp/OtpScanner.vue';

const open = defineModel<boolean>('open', { default: false });
const props = defineProps<{ title?: string; issuer?: string; account?: string }>();
const emit = defineEmits<{ setup: [tokens: ImportedToken[]] }>();

const manual = ref(false);
const secret = ref('');
const advanced = ref(false);
const type = ref<'totp' | 'hotp'>('totp');
const digits = ref(6);
const period = ref(30);
const algorithm = ref<OtpParams['algorithm']>('SHA1');
const touched = ref(false);

const isUri = computed(() => /^otpauth:\/\//i.test(secret.value.trim()));
const valid = computed(() => {
  const v = secret.value.trim();
  if (!v) return false;
  if (isUri.value) {
    try {
      parseOtpUri(v);
      return true;
    } catch {
      return false;
    }
  }
  return isValidSecret(v);
});

const digitItems = [6, 7, 8].map((n) => ({ label: String(n), value: n }));
const algorithmItems = ['SHA1', 'SHA256', 'SHA512'].map((a) => ({ label: a.replace('SHA', 'SHA-'), value: a }));
const typeItems = computed(() => [
  { label: t('otpTypeTime'), value: 'totp' },
  { label: t('otpTypeCounter'), value: 'hotp' }
]);

watch(open, (v) => {
  if (!v) return;
  manual.value = false;
  secret.value = '';
  advanced.value = false;
  type.value = 'totp';
  digits.value = 6;
  period.value = 30;
  algorithm.value = 'SHA1';
  touched.value = false;
});

function onFound(tokens: ImportedToken[]): void {
  emit('setup', tokens);
  open.value = false;
}

function saveManual(): void {
  touched.value = true;
  if (!valid.value) return;
  const v = secret.value.trim();
  if (isUri.value) {
    const p = parseOtpUri(v);
    onFound([{ issuer: p.issuer ?? '', account: p.account ?? '', uri: v }]);
    return;
  }
  const uri = buildOtpUri({
    type: type.value,
    secret: normalizeSecret(v),
    algorithm: algorithm.value,
    digits: digits.value,
    period: Math.max(1, period.value || 30),
    counter: 0,
    issuer: props.issuer || undefined,
    account: props.account || undefined
  });
  onFound([{ issuer: props.issuer ?? '', account: props.account ?? '', uri }]);
}
</script>

<template>
  <UModal v-model:open="open" :title="title ?? t('otpSetupTitle')" :description="t('otpSetupDesc')">
    <template #body>
      <div class="flex flex-col gap-4">
        <OtpScanner v-if="open && !manual" @found="onFound" />

        <UButton
          v-if="!manual"
          color="neutral"
          variant="link"
          class="self-start px-0"
          icon="i-lucide-keyboard"
          :label="t('otpEnterKey')"
          @click="manual = true"
        />

        <form v-else class="flex flex-col gap-3" @submit.prevent="saveManual">
          <UFormField
            :label="t('otpSetupKey')"
            :help="t('otpSetupKeyHelp')"
            :error="touched && !valid ? t('otpSetupKeyInvalid') : undefined"
          >
            <UInput
              v-model="secret"
              class="w-full font-mono"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              autofocus
              placeholder="JBSW Y3DP EHPK 3PXP"
              @blur="touched = true"
            />
          </UFormField>

          <template v-if="!isUri">
            <UButton
              color="neutral"
              variant="link"
              size="sm"
              class="self-start px-0"
              :icon="advanced ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
              :label="t('otpAdvanced')"
              @click="advanced = !advanced"
            />
            <div v-if="advanced" class="grid grid-cols-2 gap-3">
              <UFormField :label="t('otpType')">
                <USelect v-model="type" :items="typeItems" class="w-full" />
              </UFormField>
              <UFormField :label="t('otpDigits')">
                <USelect v-model="digits" :items="digitItems" class="w-full" />
              </UFormField>
              <UFormField v-if="type === 'totp'" :label="t('otpPeriod')">
                <UInput v-model.number="period" type="number" min="1" max="300" class="w-full" />
              </UFormField>
              <UFormField :label="t('otpAlgorithm')">
                <USelect v-model="algorithm" :items="algorithmItems" class="w-full" />
              </UFormField>
            </div>
            <p v-if="!advanced" class="text-xs text-muted">{{ t('otpAdvancedHint') }}</p>
          </template>

          <div class="flex gap-2">
            <UButton type="submit" color="primary" icon="i-lucide-check" :label="t('otpSave')" />
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-scan-line"
              :label="t('otpScanInstead')"
              @click="manual = false"
            />
          </div>
        </form>
      </div>
    </template>
  </UModal>
</template>
