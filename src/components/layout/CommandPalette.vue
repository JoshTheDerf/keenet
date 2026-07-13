<script setup lang="ts">
/**
 * Ctrl/Cmd+K command palette: quick actions + jump-to-entry search.
 * Open state lives in useOverlays so the titlebar menu and the global
 * keyboard shortcut share it.
 */
import { computed } from 'vue';
import type { CommandPaletteGroup, CommandPaletteItem } from '@nuxt/ui';
import { t } from '@/i18n';
import { useVaultStore } from '@/stores/vault';
import { useUiStore } from '@/stores/ui';
import { useOverlays } from '@/composables/useOverlays';
import { lockNow } from '@/composables/useLock';
import { iconClass } from '@/const/icons';
import type { EntryVm } from '@/types';

const vault = useVaultStore();
const ui = useUiStore();
const { commandPaletteOpen: open, auditOpen, importOpen } = useOverlays();

function close(): void {
  open.value = false;
}

/** Wrap an action so selecting it always closes the palette first. */
function run(fn: () => void): () => void {
  return () => {
    close();
    fn();
  };
}

function saveAll(): void {
  for (const f of vault.files.filter((file) => file.modified)) {
    void vault.syncFile(f.id);
  }
}

function goToEntry(entry: EntryVm): void {
  close();
  vault.setSelection({ type: 'group', fileId: entry.fileId, groupId: entry.groupId });
  vault.selectEntry(entry.id);
}

function hostOf(url: string): string {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    try {
      return new URL(`https://${url}`).host;
    } catch {
      return url;
    }
  }
}

const actionItems = computed<CommandPaletteItem[]>(() => {
  const hasModified = vault.files.some((f) => f.modified);
  return [
    {
      label: t('cmdNewEntry'),
      icon: 'i-lucide-plus',
      kbds: ['meta', 'n'],
      onSelect: run(() => void vault.createEntry())
    },
    {
      label: t('cmdGeneratePassword'),
      icon: 'i-lucide-key',
      kbds: ['meta', 'g'],
      onSelect: run(() => {
        vault.generatorOpen = true;
      })
    },
    {
      label: t('cmdPasswordAudit'),
      icon: 'i-lucide-shield-alert',
      onSelect: run(() => {
        auditOpen.value = true;
      })
    },
    {
      label: t('cmdSaveAll'),
      icon: 'i-lucide-save',
      kbds: ['meta', 's'],
      disabled: !hasModified,
      onSelect: run(saveAll)
    },
    {
      label: t('footerTitleLock'),
      icon: 'i-lucide-lock',
      kbds: ['meta', 'l'],
      onSelect: run(() => void lockNow())
    },
    {
      label: t('settings'),
      icon: 'i-lucide-settings',
      kbds: ['meta', ','],
      onSelect: run(() => ui.openSettings())
    },
    {
      label: t('cmdImport'),
      icon: 'i-lucide-file-input',
      onSelect: run(() => {
        importOpen.value = true;
      })
    },
    {
      label: t('cmdExport'),
      icon: 'i-lucide-file-output',
      onSelect: run(() => ui.openSettings('files'))
    },
    {
      label: t('cmdOpenDatabase'),
      icon: 'i-lucide-folder-open',
      onSelect: run(() => ui.showScreen('open'))
    }
  ];
});

const entryItems = computed<CommandPaletteItem[]>(() =>
  vault.allEntries
    .filter((e) => !e.inTrash)
    .map((e) => {
      const suffix = [e.username, hostOf(e.url)].filter(Boolean).join(' · ');
      return {
        label: e.title || `(${t('noTitle')})`,
        suffix,
        icon: iconClass(e.icon),
        onSelect: () => goToEntry(e)
      };
    })
);

const groups = computed<CommandPaletteGroup<CommandPaletteItem>[]>(() => [
  { id: 'actions', label: t('cmdPaletteActions'), items: actionItems.value },
  { id: 'entries', label: t('cmdPaletteEntries'), items: entryItems.value }
]);
</script>

<template>
  <UModal v-model:open="open" :title="t('cmdPalette')" :ui="{ content: 'max-w-xl' }">
    <template #content>
      <UCommandPalette
        :groups="groups"
        :placeholder="t('cmdPalettePlaceholder')"
        close
        class="h-96"
        @update:open="open = $event"
      />
    </template>
  </UModal>
</template>
