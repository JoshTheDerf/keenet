<script setup lang="ts">
import { computed, ref } from 'vue';
import type { DropdownMenuItem } from '@nuxt/ui';
import { t } from '@/i18n';
import { useVaultStore } from '@/stores/vault';
import { useUiStore } from '@/stores/ui';
import { lockNow } from '@/composables/useLock';
import { useOverlays } from '@/composables/useOverlays';
import AuditPanel from '@/components/audit/AuditPanel.vue';
import ImportDialog from '@/components/import/ImportDialog.vue';
import KeeNetLogo from '@/components/shared/KeeNetLogo.vue';

const vault = useVaultStore();
const ui = useUiStore();

const emit = defineEmits<{ toggleMenu: [] }>();

const { commandPaletteOpen, auditOpen, importOpen } = useOverlays();
const issueCount = computed(() => vault.auditIssues.length);

/** File whose contents the current selection belongs to (falls back to first). */
const activeFileId = computed<string | undefined>(() => {
  const sel = vault.selection;
  if (sel.type === 'group') return sel.fileId;
  if (sel.type === 'trash' && sel.fileId) return sel.fileId;
  return vault.files[0]?.id;
});

const hasModified = computed(() => vault.files.some((f) => f.modified));

function selectFile(fileId: string): void {
  const ft = vault.groupTrees.find((t) => t.file.id === fileId);
  if (ft) vault.setSelection({ type: 'group', fileId, groupId: ft.tree.id });
}

/** Open the open screen to add another database (keeps current files open). */
function openAnother(): void {
  ui.showScreen('open');
}

// ---- closing a single file ------------------------------------------------

const closeConfirmOpen = ref(false);
const closeTargetId = ref<string | null>(null);
const closeTargetName = computed(
  () => vault.files.find((f) => f.id === closeTargetId.value)?.name ?? ''
);

function doClose(fileId: string): void {
  const wasLast = vault.files.length <= 1;
  vault.closeFile(fileId);
  if (wasLast) ui.showScreen('open');
}

/** Close a file, confirming first if it has unsaved changes. */
function requestClose(fileId: string): void {
  const file = vault.files.find((f) => f.id === fileId);
  if (file?.modified) {
    closeTargetId.value = fileId;
    closeConfirmOpen.value = true;
  } else {
    doClose(fileId);
  }
}

function confirmClose(): void {
  if (closeTargetId.value) doClose(closeTargetId.value);
  closeConfirmOpen.value = false;
  closeTargetId.value = null;
}

const saving = ref(false);

async function onSave(): Promise<void> {
  const fileId = activeFileId.value;
  if (!fileId || saving.value) return;
  saving.value = true;
  try {
    // syncFile pulls+merges+pushes for remote files, writes back to a local
    // handle, or falls back to download — and emits its own toast.
    await vault.syncFile(fileId);
  } finally {
    saving.value = false;
  }
}

function onGenerate(): void {
  vault.generatorOpen = true;
}

function onSettings(): void {
  ui.openSettings();
}

function onLock(): void {
  // Shared lock path: best-effort persists modified files before closing.
  void lockNow();
}

// ---- overflow menu (import/export & friends) -------------------------------

const overflowItems = computed<DropdownMenuItem[]>(() => [
  {
    label: t('cmdImport'),
    icon: 'i-lucide-file-input',
    disabled: !activeFileId.value,
    onSelect: () => {
      importOpen.value = true;
    }
  },
  {
    label: t('cmdExport'),
    icon: 'i-lucide-file-output',
    disabled: !vault.hasFiles,
    onSelect: () => ui.openSettings('files')
  },
  {
    label: t('cmdPasswordAudit'),
    icon: 'i-lucide-shield-alert',
    disabled: !vault.hasFiles,
    onSelect: () => {
      auditOpen.value = true;
    }
  },
  {
    label: t('cmdPalette'),
    icon: 'i-lucide-command',
    kbds: ['meta', 'k'],
    onSelect: () => {
      commandPaletteOpen.value = true;
    }
  }
]);
</script>

<template>
  <header
    class="flex items-center gap-3 h-[var(--kw-titlebar-h)] shrink-0 px-3 border-b border-default bg-elevated/40 select-none"
  >
    <!-- Mobile menu toggle -->
    <UButton
      icon="i-lucide-menu"
      color="neutral"
      variant="ghost"
      size="sm"
      class="md:hidden"
      :aria-label="t('menu')"
      @click="emit('toggleMenu')"
    />

    <!-- Wordmark -->
    <div class="flex items-center gap-1.5 font-semibold tracking-tight">
      <KeeNetLogo class="size-5 shrink-0" />
      <span class="text-sm">KeeNet</span>
    </div>

    <!-- Open files (tabs) -->
    <nav v-if="vault.files.length" class="flex items-center gap-1 min-w-0 overflow-x-auto">
      <div
        v-for="f in vault.files"
        :key="f.id"
        class="group flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md text-xs whitespace-nowrap transition-colors cursor-pointer"
        :class="
          f.id === activeFileId
            ? 'bg-primary/10 text-primary'
            : 'text-muted hover:text-default hover:bg-elevated'
        "
        @click="selectFile(f.id)"
      >
        <UIcon name="i-lucide-database" class="size-3.5 shrink-0" />
        <span class="truncate max-w-[10rem]">{{ f.name }}</span>
        <span v-if="f.modified" class="text-primary shrink-0" aria-hidden="true">&bull;</span>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="xs"
          class="shrink-0 -my-1 opacity-0 focus:opacity-100 group-hover:opacity-100"
          :aria-label="t('appCloseFileAria', f.name)"
          @click.stop="requestClose(f.id)"
        />
      </div>

      <UTooltip :text="t('appOpenAnotherDb')">
        <UButton
          icon="i-lucide-plus"
          color="neutral"
          variant="ghost"
          size="xs"
          class="shrink-0"
          :aria-label="t('appOpenAnotherDb')"
          @click="openAnother"
        />
      </UTooltip>
    </nav>

    <div class="flex-1" />

    <!-- Actions -->
    <div class="flex items-center gap-0.5">
      <UTooltip :text="t('setFileSave')" :kbds="['meta', 's']">
        <UButton
          icon="i-lucide-save"
          color="neutral"
          variant="ghost"
          size="sm"
          :loading="saving"
          :disabled="!hasModified || saving"
          :aria-label="t('setFileSave')"
          @click="onSave"
        />
      </UTooltip>
      <UTooltip :text="t('cmdGeneratePassword')" :kbds="['meta', 'g']">
        <UButton
          icon="i-lucide-key"
          color="neutral"
          variant="ghost"
          size="sm"
          :aria-label="t('cmdGeneratePassword')"
          @click="onGenerate"
        />
      </UTooltip>
      <UTooltip :text="t('cmdPasswordAudit')">
        <UChip :show="issueCount > 0" :text="issueCount" size="2xl" color="warning">
          <UButton
            icon="i-lucide-shield-alert"
            color="neutral"
            variant="ghost"
            size="sm"
            :disabled="!vault.hasFiles"
            :aria-label="t('cmdPasswordAudit')"
            @click="auditOpen = true"
          />
        </UChip>
      </UTooltip>
      <UTooltip :text="t('settings')" :kbds="['meta', ',']">
        <UButton
          icon="i-lucide-settings"
          color="neutral"
          variant="ghost"
          size="sm"
          :aria-label="t('settings')"
          @click="onSettings"
        />
      </UTooltip>
      <UTooltip :text="t('footerTitleLock')" :kbds="['meta', 'l']">
        <UButton
          icon="i-lucide-lock"
          color="neutral"
          variant="ghost"
          size="sm"
          :disabled="!vault.hasFiles"
          :aria-label="t('footerTitleLock')"
          @click="onLock"
        />
      </UTooltip>
      <UDropdownMenu :items="overflowItems" :content="{ align: 'end' }">
        <UButton
          icon="i-lucide-ellipsis-vertical"
          color="neutral"
          variant="ghost"
          size="sm"
          :aria-label="t('openMore')"
        />
      </UDropdownMenu>
    </div>

    <AuditPanel v-model:open="auditOpen" />
    <ImportDialog v-if="activeFileId" v-model:open="importOpen" :file-id="activeFileId" />

    <!-- Confirm closing a file with unsaved changes -->
    <UModal v-model:open="closeConfirmOpen" :title="t('appCloseDbQuestion')">
      <template #body>
        <p class="text-sm text-muted">
          <span class="font-medium text-default">{{ closeTargetName }}</span>
          {{ t('appCloseDbUnsavedBody') }}
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" :label="t('alertCancel')" @click="closeConfirmOpen = false" />
          <UButton color="error" :label="t('setFileCloseNoSave')" @click="confirmClose" />
        </div>
      </template>
    </UModal>
  </header>
</template>
