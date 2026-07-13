<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@/i18n';
import { useVaultStore } from '@/stores/vault';

const props = defineProps<{ fileId: string; entryId: string; length: number }>();
const open = defineModel<boolean>('open', { required: true });

const vault = useVaultStore();

const indices = computed(() => Array.from({ length: props.length }, (_, i) => i));

function revert(index: number): void {
  vault.revertHistory(props.fileId, props.entryId, index);
  open.value = false;
}

function remove(index: number): void {
  vault.deleteHistory(props.fileId, props.entryId, index);
}
</script>

<template>
  <UModal v-model:open="open" :title="t('history')">
    <template #body>
      <div class="flex flex-col gap-1.5">
        <p v-if="!indices.length" class="text-sm text-muted">{{ t('detHistoryEmpty') }}</p>
        <div
          v-for="index in indices"
          :key="index"
          class="flex items-center gap-2 rounded-md border border-default px-2 py-1.5"
        >
          <span class="flex-1 text-sm">{{ t('detHistoryVersion') }} {{ index + 1 }}</span>
          <UButton
            color="neutral"
            variant="soft"
            size="xs"
            icon="i-lucide-history"
            @click="revert(index)"
          >
            {{ t('detHistoryRevert') }}
          </UButton>
          <UButton
            color="error"
            variant="ghost"
            size="xs"
            icon="i-lucide-trash-2"
            :aria-label="t('detHistoryDel')"
            @click="remove(index)"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
