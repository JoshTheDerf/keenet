<script setup lang="ts">
import { ref, computed } from 'vue';
import type { DropdownMenuItem } from '@nuxt/ui';
import { t } from '@/i18n';
import { useVaultStore } from '@/stores/vault';
import { useOtpCode, useOtpActions } from '@/composables/useOtp';
import { formatOtpCode } from '@/domain/otp';
import type { ImportedToken } from '@/domain/otp-import';
import type { EntryVm } from '@/types';
import OtpRing from '@/components/otp/OtpRing.vue';
import OtpSetupModal from '@/components/otp/OtpSetupModal.vue';
import ConfirmModal from '@/components/shared/ConfirmModal.vue';

const props = defineProps<{ entry: EntryVm }>();

const vault = useVaultStore();
const { copyOtp, otpOf } = useOtpActions();
const { params, code, timeLeft, fraction, invalid } = useOtpCode(() => otpOf(props.entry));

const setupOpen = ref(false);
const removeOpen = ref(false);

const detail = computed(() => {
  const p = params.value;
  if (!p) return '';
  return [p.issuer, p.account].filter(Boolean).join(' · ');
});

const menuItems = computed<DropdownMenuItem[]>(() => [
  { label: t('otpReplace'), icon: 'i-lucide-scan-line', onSelect: () => (setupOpen.value = true) },
  { label: t('detOtpRemove'), icon: 'i-lucide-trash', color: 'error', onSelect: () => (removeOpen.value = true) }
]);

function onSetup(tokens: ImportedToken[]): void {
  const e = props.entry;
  if (tokens.length > 1) {
    // a Google Authenticator export carries several accounts: add them all
    vault.importOtp(e.fileId, tokens, true);
    return;
  }
  const tok = tokens[0];
  vault.setOtp(e.fileId, e.id, tok.uri);
  // a fresh entry takes its name and user from the code
  if (!e.title && (tok.issuer || tok.account)) vault.updateField(e.fileId, e.id, 'Title', tok.issuer || tok.account);
  if (!e.username && tok.issuer && tok.account) vault.updateField(e.fileId, e.id, 'UserName', tok.account);
}

function removeOtp(): void {
  vault.setOtp(props.entry.fileId, props.entry.id, undefined);
}
</script>

<template>
  <UFormField :label="t('detOtpField')">
    <div v-if="params" class="flex items-center gap-2">
      <UTooltip :text="t('otpTapToCopy')">
        <button
          type="button"
          class="group flex items-center gap-3 rounded-lg px-3 py-1.5 -ml-3 hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          :aria-label="`${t('detMenuCopyOtp')}: ${code}`"
          data-testid="otp-code"
          @click="copyOtp(entry)"
        >
          <span class="font-mono text-2xl font-semibold tracking-wider tabular-nums text-highlighted">
            {{ code ? formatOtpCode(code) : '––– –––' }}
          </span>
          <OtpRing v-if="params.type === 'totp'" :fraction="fraction" :seconds="timeLeft" :size="26" label />
          <UIcon name="i-lucide-copy" class="size-4 text-muted pointer-fine:opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
        </button>
      </UTooltip>

      <UTooltip v-if="params.type === 'hotp'" :text="t('otpNextCode')">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-refresh-cw"
          :aria-label="t('otpNextCode')"
          @click="vault.advanceHotp(entry.fileId, entry.id)"
        />
      </UTooltip>

      <UDropdownMenu :items="menuItems" :content="{ align: 'end' }">
        <UButton color="neutral" variant="ghost" icon="i-lucide-ellipsis" :aria-label="t('options')" />
      </UDropdownMenu>
    </div>
    <p v-if="params && detail" class="text-xs text-muted truncate">{{ detail }}</p>

    <div v-if="!params" class="flex flex-wrap items-center gap-2">
      <UButton
        color="neutral"
        variant="soft"
        size="sm"
        icon="i-lucide-scan-line"
        data-testid="otp-add"
        @click="setupOpen = true"
      >
        {{ t('otpAdd') }}
      </UButton>
      <template v-if="invalid">
        <span class="text-xs text-error">{{ t('detOtpInvalid') }}</span>
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-x"
          :aria-label="t('detOtpRemove')"
          @click="removeOpen = true"
        />
      </template>
    </div>
  </UFormField>

  <ConfirmModal
    v-model:open="removeOpen"
    :title="t('detOtpRemove')"
    :description="t('detOtpRemoveBody')"
    :confirm-label="t('remove')"
    @confirm="removeOtp"
  />

  <OtpSetupModal
    v-model:open="setupOpen"
    :issuer="entry.title"
    :account="entry.username"
    @setup="onSetup"
  />
</template>
