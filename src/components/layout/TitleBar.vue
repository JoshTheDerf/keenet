<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue';
import type { DropdownMenuItem } from '@nuxt/ui';
import { useMediaQuery } from '@vueuse/core';
import { t } from '@/i18n';
import { useVaultStore } from '@/stores/vault';
import { useUiStore } from '@/stores/ui';
import { lockNow } from '@/composables/useLock';
import { useOverlays } from '@/composables/useOverlays';
import AuditPanel from '@/components/audit/AuditPanel.vue';
import ImportDialog from '@/components/import/ImportDialog.vue';
import KeeNetLogo from '@/components/shared/KeeNetLogo.vue';
import CloseFileConfirm from '@/components/shared/CloseFileConfirm.vue';

const vault = useVaultStore();
const ui = useUiStore();

const emit = defineEmits<{ toggleMenu: [] }>();

const { commandPaletteOpen, auditOpen, importOpen } = useOverlays();
const issueCount = computed(() => vault.auditIssues.length);

// Phone width: the generator and audit buttons move into the overflow menu so
// the bar doesn't scroll sideways.
const compact = useMediaQuery('(max-width: 639px)');

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

const closer = useTemplateRef<InstanceType<typeof CloseFileConfirm>>('closer');

function onClosed(wasLast: boolean): void {
  if (wasLast) ui.showScreen('open');
}

const saving = ref(false);

/** Save every modified file, same as Ctrl/Cmd+S. */
async function onSave(): Promise<void> {
  if (saving.value) return;
  const modified = vault.files.filter((f) => f.modified);
  if (!modified.length) return;
  saving.value = true;
  try {
    // syncFile pulls+merges+pushes for remote files, writes back to a local
    // handle, or falls back to download, and shows its own toast.
    await Promise.all(modified.map((f) => vault.syncFile(f.id)));
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
  ...(compact.value
    ? [
        {
          label: t('cmdGeneratePassword'),
          icon: 'i-lucide-key',
          onSelect: onGenerate
        },
        {
          label: issueCount.value
            ? `${t('cmdPasswordAudit')} (${issueCount.value})`
            : t('cmdPasswordAudit'),
          icon: 'i-lucide-shield-alert',
          disabled: !vault.hasFiles,
          onSelect: () => {
            auditOpen.value = true;
          }
        }
      ]
    : []),
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
    class="flex items-center gap-2 sm:gap-3 h-[var(--kw-titlebar-h)] shrink-0 px-2 sm:px-3 border-b border-default bg-elevated/40 select-none"
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

    <!-- Wordmark (dropped on phones when file tabs need the room) -->
    <div
      class="items-center gap-1.5 font-semibold tracking-tight"
      :class="vault.files.length ? 'hidden sm:flex' : 'flex'"
    >
      <KeeNetLogo class="size-5 shrink-0" />
      <span class="text-sm">KeeNet</span>
    </div>

    <!-- Open files (tabs) -->
    <nav v-if="vault.files.length" class="flex items-center gap-1 min-w-0 overflow-x-auto">
      <div
        v-for="f in vault.files"
        :key="f.id"
        class="group flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md text-xs whitespace-nowrap transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        :class="
          f.id === activeFileId
            ? 'bg-primary/10 text-primary'
            : 'text-muted hover:text-default hover:bg-elevated'
        "
        role="button"
        tabindex="0"
        :aria-current="f.id === activeFileId ? 'true' : undefined"
        @click="selectFile(f.id)"
        @keydown.enter.self="selectFile(f.id)"
        @keydown.space.self.prevent="selectFile(f.id)"
      >
        <UIcon name="i-lucide-database" class="size-3.5 shrink-0" />
        <span class="truncate max-w-[10rem]">{{ f.name }}</span>
        <span v-if="f.modified" class="text-primary shrink-0" :title="t('unsaved')">&bull;</span>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="xs"
          class="shrink-0 -my-1 pointer-fine:opacity-0 focus-visible:opacity-100 pointer-fine:group-hover:opacity-100"
          :aria-label="t('appCloseFileAria', f.name)"
          @click.stop="closer?.request(f.id)"
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
      <UTooltip v-if="!compact" :text="t('cmdGeneratePassword')" :kbds="['meta', 'g']">
        <UButton
          icon="i-lucide-key"
          color="neutral"
          variant="ghost"
          size="sm"
          :aria-label="t('cmdGeneratePassword')"
          @click="onGenerate"
        />
      </UTooltip>
      <UTooltip v-if="!compact" :text="t('cmdPasswordAudit')">
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

    <CloseFileConfirm ref="closer" @closed="onClosed" />
  </header>
</template>
