<script setup lang="ts">
// Every one-time code at a glance, like an authenticator app: tap a row to
// copy its code; the arrow opens the entry.
import { ref } from 'vue';
import { t } from '@/i18n';
import { useVaultStore } from '@/stores/vault';
import { useOverlays } from '@/composables/useOverlays';
import type { ImportedToken } from '@/domain/otp-import';
import OtpCodeRow from '@/components/otp/OtpCodeRow.vue';
import OtpSetupModal from '@/components/otp/OtpSetupModal.vue';

const vault = useVaultStore();
const { importOpen, importMode } = useOverlays();
const setupOpen = ref(false);

function openImport(): void {
  importMode.value = 'otp';
  importOpen.value = true;
}

function onSetup(tokens: ImportedToken[]): void {
  const fileId = vault.files[0]?.id;
  if (fileId) vault.importOtp(fileId, tokens, true);
}
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="flex items-center gap-1 px-3 py-1.5 border-b border-default shrink-0">
      <span class="flex-1 text-xs text-muted">
        {{ vault.list.length === 1 ? t('otpOneCode') : t('otpCodesCount', vault.list.length) }}
      </span>
      <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-file-input" :label="t('otpImport')" @click="openImport" />
      <UButton size="xs" color="primary" variant="soft" icon="i-lucide-scan-line" :label="t('otpAddShort')" data-testid="otp-scan" @click="setupOpen = true" />
    </div>

    <ul v-if="vault.list.length" class="flex-1 min-h-0 overflow-y-auto" :aria-label="t('otpCodes')">
      <OtpCodeRow v-for="entry in vault.list" :key="entry.id" :entry="entry" />
    </ul>

    <div v-else class="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
      <UIcon name="i-lucide-timer" class="size-10 text-muted" />
      <p class="text-sm text-muted max-w-64">
        {{ vault.search.text ? t('openNothingFound') : t('otpEmpty') }}
      </p>
      <div v-if="!vault.search.text && vault.hasFiles" class="flex flex-wrap justify-center gap-2">
        <UButton color="primary" icon="i-lucide-scan-line" :label="t('otpScanQr')" @click="setupOpen = true" />
        <UButton color="neutral" variant="soft" icon="i-lucide-file-input" :label="t('otpImportFreeOtp')" @click="openImport" />
      </div>
    </div>

    <OtpSetupModal v-model:open="setupOpen" :title="t('otpAddTitle')" @setup="onSetup" />
  </div>
</template>
