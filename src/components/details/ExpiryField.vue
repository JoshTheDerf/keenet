<script setup lang="ts">
import { ref, watch } from 'vue';
import { t } from '@/i18n';
import { useVaultStore } from '@/stores/vault';

const props = defineProps<{
  fileId: string;
  entryId: string;
  expires?: number;
  expired: boolean;
}>();

const vault = useVaultStore();

function toInput(ms: number | undefined): string {
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const local = ref(toInput(props.expires));

watch(
  () => props.expires,
  (ms) => {
    local.value = toInput(ms);
  }
);

function commit(): void {
  if (!local.value) {
    vault.setExpiry(props.fileId, props.entryId, undefined);
    return;
  }
  const ms = new Date(`${local.value}T23:59:59`).getTime();
  if (!Number.isNaN(ms)) vault.setExpiry(props.fileId, props.entryId, ms);
}

function clear(): void {
  local.value = '';
  vault.setExpiry(props.fileId, props.entryId, undefined);
}
</script>

<template>
  <UFormField :label="t('detExpires')">
    <div class="flex items-center gap-1.5">
      <UInput v-model="local" type="date" class="w-48" @change="commit" @blur="commit" />
      <UButton
        v-if="local"
        color="neutral"
        variant="ghost"
        icon="i-lucide-x"
        :aria-label="t('detClearExpiry')"
        @click="clear"
      />
      <UBadge v-if="props.expired" color="error" variant="subtle">{{ t('detExpired') }}</UBadge>
    </div>
  </UFormField>
</template>
