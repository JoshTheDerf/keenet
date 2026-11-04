<script setup lang="ts">
import { ref, computed, watch, nextTick, useTemplateRef, onBeforeUpdate } from 'vue';
import EntryListItem from '@/components/list/EntryListItem.vue';
import OtpCodesList from '@/components/otp/OtpCodesList.vue';
import { useVaultStore } from '@/stores/vault';
import { useSettingsStore } from '@/stores/settings';
import { useUiStore } from '@/stores/ui';
import { useOverlays } from '@/composables/useOverlays';
import { useOtpActions } from '@/composables/useOtp';
import { useClipboard } from '@/composables/useClipboard';
import type { ContextMenuItem } from '@nuxt/ui';
import type { EntryVm } from '@/types';
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
  return n === 1 ? t('listOneEntry') : t('setFileEntriesCount', n);
});

// Creating or importing only makes sense when looking at a group or everything;
// an empty tag, color, expired or trash view just says so.
const canCreateHere = computed(
  () => vault.selection.type === 'all' || vault.selection.type === 'group'
);

function onSelect(id: string): void {
  if (suppressSelect) return;
  vault.selectEntry(id);
}

// ---- quick actions: long-press (touch) or right-click on a row ------------

const { copy } = useClipboard();
const { copyOtp } = useOtpActions();
const ctxEntry = ref<EntryVm | null>(null);
/** a long-press ends in a tap; that tap must not also open the entry */
let suppressSelect = false;

function pickTarget(e: Event): void {
  const id = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-entry-id]')?.dataset.entryId;
  ctxEntry.value = (id && entries.value.find((x) => x.id === id)) || null;
}

function onCtxOpen(open: boolean): void {
  if (!open) return;
  suppressSelect = true;
  setTimeout(() => (suppressSelect = false), 700);
}

const ctxItems = computed<ContextMenuItem[][]>(() => {
  const e = ctxEntry.value;
  if (!e) return [];
  const resolve = (v: string) => vault.resolveReference(e.fileId, v);
  const copyItems: ContextMenuItem[] = [];
  if (e.username) copyItems.push({ label: t('detCopyField', t('user')), icon: 'i-lucide-user', onSelect: () => copy(resolve(e.username), t('user')) });
  if (e.password) copyItems.push({ label: t('detCopyField', t('password')), icon: 'i-lucide-key-round', onSelect: () => copy(resolve(e.password), t('password'), { sensitive: true }) });
  if (e.otp) copyItems.push({ label: t('detMenuCopyOtp'), icon: 'i-lucide-timer', onSelect: () => copyOtp(e) });
  const other: ContextMenuItem[] = [];
  if (e.url) {
    const url = resolve(e.url);
    other.push({ label: t('detOpenWebsite'), icon: 'i-lucide-external-link', onSelect: () => window.open(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`, '_blank', 'noopener,noreferrer') });
  }
  other.push({ label: t('detOpenEntry'), icon: 'i-lucide-square-pen', onSelect: () => vault.selectEntry(e.id) });
  return [copyItems, other].filter((g) => g.length);
});

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
  <OtpCodesList v-if="vault.selection.type === 'otp'" />
  <div v-else ref="container" class="flex flex-col h-full outline-none" tabindex="0" @keydown="onKeydown">
    <!-- Count header -->
    <div
      v-if="entries.length"
      class="px-5 pb-1 text-xs text-muted shrink-0"
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

    <!-- Entries (long-press or right-click a row for quick actions) -->
    <UContextMenu v-if="entries.length" :items="ctxItems" :disabled="!ctxEntry" @update:open="onCtxOpen">
      <div
        class="flex-1 min-h-0 overflow-y-auto px-2 pb-2 max-md:pb-24"
        :role="settings.tableView ? 'table' : 'listbox'"
        @pointerdown.capture="pickTarget"
        @contextmenu.capture="pickTarget"
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
    </UContextMenu>

    <!-- Empty state -->
    <div v-else class="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
      <span class="flex items-center justify-center size-16 rounded-full bg-primary/10">
        <UIcon name="i-lucide-inbox" class="size-8 text-primary" />
      </span>
      <p class="text-muted">{{ emptyMessage }}</p>

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
      <div v-else-if="canCreateHere" class="flex flex-wrap items-center justify-center gap-2">
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
