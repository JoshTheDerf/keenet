<script setup lang="ts">
import { computed, watch, nextTick, useTemplateRef, onBeforeUpdate } from 'vue';
import EntryListItem from '@/components/list/EntryListItem.vue';
import { useVaultStore } from '@/stores/vault';
import { useSettingsStore } from '@/stores/settings';
import { useUiStore } from '@/stores/ui';
import { useOverlays } from '@/composables/useOverlays';
import { t } from '@/i18n';

const vault = useVaultStore();
const settings = useSettingsStore();
const ui = useUiStore();
const { importOpen } = useOverlays();

const entries = computed(() => vault.list);
const searching = computed(() => !!vault.search.text);

const emptyMessage = computed(() => {
  if (!vault.hasFiles) return t('openClickToOpen');
  if (searching.value) return t('openNothingFound');
  return t('listNoEntries');
});

const countLabel = computed(() => {
  const n = entries.value.length;
  return `${n} ${n === 1 ? 'entry' : 'entries'}`;
});

function onSelect(id: string): void {
  vault.selectEntry(id);
}

// ---- empty-state actions ---------------------------------------------------

function newEntry(): void {
  vault.createEntry();
}

function openImport(): void {
  importOpen.value = true;
}

async function openDemo(): Promise<void> {
  await vault.createFile({ name: 'Demo', password: 'demo' });
}

function openDatabase(): void {
  ui.showScreen('open');
}

function clearSearch(): void {
  vault.setSearch({ text: '' });
}

// ---- keyboard navigation + roving focus -------------------------------------

const container = useTemplateRef<HTMLElement>('container');

interface ItemHandle {
  focus: () => void;
}

const itemRefs = new Map<string, ItemHandle>();

function setItemRef(id: string, el: unknown): void {
  const handle = el as ItemHandle | null;
  if (handle) itemRefs.set(id, handle);
  else itemRefs.delete(id);
}

onBeforeUpdate(() => itemRefs.clear());

// When the selection changes while focus is inside the list, move focus to the
// newly selected item so keyboard users always "hold" the active row.
watch(
  () => vault.selectedEntryId,
  async (id) => {
    if (!id) return;
    await nextTick();
    if (container.value?.contains(document.activeElement)) {
      itemRefs.get(id)?.focus();
    }
  }
);

function moveSelection(delta: number): void {
  const list = entries.value;
  if (!list.length) return;
  const currentIndex = list.findIndex((e) => e.id === vault.selectedEntryId);
  let next = currentIndex + delta;
  if (currentIndex === -1) next = delta > 0 ? 0 : list.length - 1;
  next = Math.max(0, Math.min(list.length - 1, next));
  const target = list[next];
  if (target) vault.selectEntry(target.id);
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    moveSelection(1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    moveSelection(-1);
  }
}
</script>

<template>
  <div ref="container" class="flex flex-col h-full outline-none" tabindex="0" @keydown="onKeydown">
    <!-- Count header -->
    <div
      v-if="entries.length"
      class="px-3 py-1.5 text-xs text-muted border-b border-default shrink-0"
    >
      {{ countLabel }}
    </div>

    <!-- Table header row -->
    <div
      v-if="settings.tableView && entries.length"
      class="grid grid-cols-[2fr_1.5fr_1.5fr_auto] gap-2 px-3 py-1.5 text-xs font-medium capitalize text-muted border-b border-default shrink-0"
      role="row"
    >
      <span role="columnheader">{{ t('title') }}</span>
      <span role="columnheader">{{ t('user') }}</span>
      <span role="columnheader">{{ t('website') }}</span>
      <span role="columnheader">{{ t('searchUpdated') }}</span>
    </div>

    <!-- Entries -->
    <div
      v-if="entries.length"
      class="flex-1 min-h-0 overflow-y-auto"
      :role="settings.tableView ? 'table' : 'listbox'"
    >
      <EntryListItem
        v-for="entry in entries"
        :key="entry.id"
        :ref="(el) => setItemRef(entry.id, el)"
        :entry="entry"
        :selected="entry.id === vault.selectedEntryId"
        :table="settings.tableView"
        @select="onSelect"
      />
    </div>

    <!-- Empty state -->
    <div v-else class="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
      <UIcon name="i-lucide-inbox" class="size-10 text-muted" />
      <p class="text-sm text-muted">{{ emptyMessage }}</p>

      <!-- No database open -->
      <UButton
        v-if="!vault.hasFiles"
        color="primary"
        icon="i-lucide-folder-open"
        :label="t('cmdOpenDatabase')"
        @click="openDatabase"
      />

      <!-- No results for the current search -->
      <UButton
        v-else-if="searching"
        color="neutral"
        variant="soft"
        icon="i-lucide-x"
        :label="t('searchClear')"
        @click="clearSearch"
      />

      <!-- Database open but empty -->
      <div v-else class="flex flex-wrap items-center justify-center gap-2">
        <UButton color="primary" icon="i-lucide-plus" :label="t('cmdNewEntry')" @click="newEntry" />
        <UButton
          color="neutral"
          variant="soft"
          icon="i-lucide-file-input"
          :label="t('cmdImport')"
          @click="openImport"
        />
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-sparkles"
          :label="t('listEmptyDemo')"
          @click="openDemo"
        />
      </div>
    </div>
  </div>
</template>
