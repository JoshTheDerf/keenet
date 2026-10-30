<script setup lang="ts">
import { t } from '@/i18n';
import { useVaultStore } from '@/stores/vault';
import { useUiStore } from '@/stores/ui';
import { downloadData } from '@/storage/local';
import type { AttachmentVm } from '@/types';

const props = defineProps<{ fileId: string; entryId: string; attachments: AttachmentVm[] }>();

const vault = useVaultStore();
const ui = useUiStore();

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function download(name: string): void {
  const data = vault.getAttachmentData(props.fileId, props.entryId, name);
  if (data) downloadData(name, data);
  else ui.notify(t('detAttachmentUnavailable'), { color: 'error' });
}

function remove(name: string): void {
  vault.removeAttachment(props.fileId, props.entryId, name);
}
</script>

<template>
  <UFormField :label="t('detAttachments')">
    <div class="flex flex-col gap-1.5">
      <div
        v-for="att in props.attachments"
        :key="att.name"
        class="flex items-center gap-2 rounded-md border border-default px-2 py-1.5"
      >
        <UIcon name="i-lucide-paperclip" class="shrink-0 text-muted" />
        <span class="flex-1 min-w-0 truncate text-sm">{{ att.name }}</span>
        <span class="text-xs text-muted">{{ formatSize(att.size) }}</span>
        <UTooltip :text="t('detAttSave')">
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-download"
            :aria-label="t('detAttSave')"
            @click="download(att.name)"
          />
        </UTooltip>
        <UTooltip :text="t('remove')">
          <UButton
            color="error"
            variant="ghost"
            size="xs"
            icon="i-lucide-trash-2"
            :aria-label="t('remove')"
            @click="remove(att.name)"
          />
        </UTooltip>
      </div>

    </div>
  </UFormField>
</template>
