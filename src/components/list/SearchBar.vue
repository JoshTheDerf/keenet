<script setup lang="ts">
import { computed, watch, useTemplateRef, nextTick } from 'vue';
import { useVaultStore } from '@/stores/vault';
import { useUiStore } from '@/stores/ui';
import { t } from '@/i18n';
import type { SortField } from '@/types';
import type { DropdownMenuItem } from '@nuxt/ui';

const vault = useVaultStore();
const ui = useUiStore();

// Focus the search box when a Ctrl/Cmd+F shortcut is requested.
const searchInput = useTemplateRef<{ inputRef?: HTMLInputElement } & HTMLElement>('searchInput');
watch(
  () => ui.focusSearchToken,
  async () => {
    await nextTick();
    const el = searchInput.value;
    const input = (el as unknown as { inputRef?: HTMLInputElement })?.inputRef ?? el?.querySelector?.('input');
    input?.focus();
    if (ui.focusSearchSelect) input?.select();
    else input?.setSelectionRange(input.value.length, input.value.length);
  }
);

interface SortOption {
  field: SortField;
  label: string;
  icon: string;
}

/** First letter uppercased — several legacy keys are lowercase nouns. */
function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

const sortOptions = computed<SortOption[]>(() => [
  { field: 'title', label: capitalize(t('title')), icon: 'i-lucide-type' },
  { field: 'username', label: capitalize(t('user')), icon: 'i-lucide-user' },
  { field: 'url', label: capitalize(t('website')), icon: 'i-lucide-globe' },
  { field: 'created', label: t('searchCreated'), icon: 'i-lucide-calendar-plus' },
  { field: 'updated', label: t('searchUpdated'), icon: 'i-lucide-calendar-clock' }
]);

const dirIcon = computed(() =>
  vault.sortDir === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down'
);

const currentSortLabel = computed(
  () => sortOptions.value.find((o) => o.field === vault.sortField)?.label ?? ''
);

// Sorting and search options share one menu: they're set rarely, and the
// search row stays short enough for phones.
const viewItems = computed<DropdownMenuItem[][]>(() => [
  [
    { type: 'label', label: t('searchSort') },
    ...sortOptions.value.map((o) => ({
      label: o.label,
      icon: o.icon,
      type: 'checkbox' as const,
      checked: o.field === vault.sortField,
      onSelect: (e: Event) => {
        e.preventDefault();
        vault.setSort(o.field, o.field === vault.sortField ? vault.sortDir : 'asc');
      }
    })),
    {
      label: vault.sortDir === 'asc' ? t('searchAscending') : t('searchDescending'),
      icon: dirIcon.value,
      onSelect: (e: Event) => {
        e.preventDefault();
        vault.setSort(vault.sortField, vault.sortDir === 'asc' ? 'desc' : 'asc');
      }
    }
  ],
  [
    { type: 'label', label: t('searchOptionsTitle') },
    ...([
      ['caseSensitive', t('searchCase')],
      ['regex', t('searchRegex')],
      ['includeProtected', t('searchProtect')]
    ] as const).map(([key, label]) => ({
      label,
      type: 'checkbox' as const,
      checked: vault.search[key] ?? false,
      onUpdateChecked: (v: boolean) => vault.setSearch({ [key]: v }),
      onSelect: (e: Event) => e.preventDefault()
    }))
  ]
]);

/** Search options in effect, so a filtered list never looks like a bug. */
const optionsActive = computed(
  () => !!(vault.search.caseSensitive || vault.search.regex || vault.search.includeProtected)
);

function onSearchInput(value: string): void {
  vault.setSearch({ text: value });
}

function clearSearch(): void {
  vault.setSearch({ text: '' });
}

// Keys in the search box drive the list: arrows pick an entry, Enter opens the
// first match, Escape clears.
function onSearchKeydown(e: KeyboardEvent): void {
  const list = vault.list;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!list.length) return;
    e.preventDefault();
    const i = list.findIndex((x) => x.id === vault.selectedEntryId);
    const next = e.key === 'ArrowDown' ? Math.min(list.length - 1, i + 1) : Math.max(0, i - 1);
    vault.selectEntry(list[i === -1 ? 0 : next].id);
  } else if (e.key === 'Enter') {
    if (!list.length) return;
    e.preventDefault();
    if (!list.some((x) => x.id === vault.selectedEntryId)) vault.selectEntry(list[0].id);
  } else if (e.key === 'Escape' && vault.search.text) {
    e.preventDefault();
    e.stopPropagation();
    clearSearch();
  }
}
</script>

<template>
  <div class="flex items-center gap-1.5 px-3 pt-3 pb-2">
    <UInput
      ref="searchInput"
      :model-value="vault.search.text ?? ''"
      icon="i-lucide-search"
      variant="soft"
      :ui="{ base: 'rounded-full bg-elevated/70 focus:bg-default focus:ring-1 focus:ring-accented' }"
      :placeholder="t('search')"
      autocomplete="off"
      spellcheck="false"
      class="flex-1 min-w-0"
      @update:model-value="onSearchInput"
      @keydown="onSearchKeydown"
    >
      <template #trailing>
        <UButton
          v-if="vault.search.text"
          color="neutral"
          variant="link"
          size="xs"
          icon="i-lucide-x"
          :aria-label="t('searchClear')"
          @click="clearSearch"
        />
        <span v-else class="hidden sm:flex items-center gap-0.5" aria-hidden="true">
          <UKbd value="meta" size="sm" />
          <UKbd value="F" size="sm" />
        </span>
      </template>
    </UInput>

    <UDropdownMenu :items="viewItems" :content="{ align: 'end' }">
      <UTooltip :text="`${t('searchViewOptions')}: ${currentSortLabel}`">
        <UChip :show="optionsActive" color="primary" size="sm" inset>
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-arrow-up-down"
            :aria-label="t('searchViewOptions')"
            data-testid="view-options"
          />
        </UChip>
      </UTooltip>
    </UDropdownMenu>
  </div>
</template>
