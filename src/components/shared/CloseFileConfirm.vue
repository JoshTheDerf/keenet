<script setup lang="ts">
/**
 * Closing an open database. Call `request(fileId)` through a template ref: a
 * file without unsaved changes closes right away, otherwise this asks whether
 * to save first, close anyway or cancel. Emits `closed` once the file is gone.
 */
import { ref, computed } from 'vue';
import { t } from '@/i18n';
import { useVaultStore } from '@/stores/vault';

const emit = defineEmits<{ closed: [wasLast: boolean] }>();

const vault = useVaultStore();

const open = ref(false);
const targetId = ref<string | null>(null);
const saving = ref(false);
const targetName = computed(() => vault.files.find((f) => f.id === targetId.value)?.name ?? '');

function close(fileId: string): void {
  const wasLast = vault.files.length <= 1;
  vault.closeFile(fileId);
  emit('closed', wasLast);
}

function request(fileId: string): void {
  const file = vault.files.find((f) => f.id === fileId);
  if (!file) return;
  if (!file.modified) {
    close(fileId);
    return;
  }
  targetId.value = fileId;
  open.value = true;
}

function discard(): void {
  if (targetId.value) close(targetId.value);
  open.value = false;
}

async function saveAndClose(): Promise<void> {
  const id = targetId.value;
  if (!id || saving.value) return;
  saving.value = true;
  try {
    // syncFile shows its own error toast; keep the dialog open if it failed.
    if (await vault.syncFile(id)) {
      close(id);
      open.value = false;
    }
  } finally {
    saving.value = false;
  }
}

defineExpose({ request });
</script>

<template>
  <UModal v-model:open="open" :title="t('appCloseDbQuestion')">
    <template #body>
      <p class="text-sm text-muted">{{ t('appCloseDbConfirm', targetName) }}</p>
    </template>
    <template #footer>
      <div class="flex flex-wrap justify-end gap-2 w-full">
        <UButton color="neutral" variant="ghost" :label="t('alertCancel')" @click="open = false" />
        <UButton
          color="error"
          variant="soft"
          :label="t('setFileCloseNoSave')"
          :disabled="saving"
          @click="discard"
        />
        <UButton
          color="primary"
          icon="i-lucide-save"
          :label="t('appSaveAndClose')"
          :loading="saving"
          @click="saveAndClose"
        />
      </div>
    </template>
  </UModal>
</template>
