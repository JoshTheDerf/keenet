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
    input?.select();
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

const sortItems = computed<DropdownMenuItem[]>(() =>
  sortOptions.value.map((o) => ({
    label: o.label,
    icon: o.icon,
    active: o.field === vault.sortField,
    onSelect: () => vault.setSort(o.field)
  }))
);

function onSearchInput(value: string): void {
  vault.setSearch({ text: value });
}

function clearSearch(): void {
  vault.setSearch({ text: '' });
}

function newEntry(): void {
  vault.createEntry();
}

const caseSensitive = computed({
  get: () => vault.search.caseSensitive ?? false,
  set: (v: boolean) => vault.setSearch({ caseSensitive: v })
});
const regex = computed({
  get: () => vault.search.regex ?? false,
  set: (v: boolean) => vault.setSearch({ regex: v })
});
const includeProtected = computed({
  get: () => vault.search.includeProtected ?? false,
  set: (v: boolean) => vault.setSearch({ includeProtected: v })
});
</script>

<template>
  <div class="flex items-center gap-1.5 p-2 border-b border-default">
    <UInput
      ref="searchInput"
      :model-value="vault.search.text ?? ''"
      icon="i-lucide-search"
      :placeholder="t('search')"
      autocomplete="off"
      spellcheck="false"
      class="flex-1 min-w-0"
      @update:model-value="onSearchInput"
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

    <UTooltip :text="t('searchAddNew')" :kbds="['meta', 'n']">
      <UButton
        color="primary"
        icon="i-lucide-plus"
        :aria-label="t('searchAddNew')"
        @click="newEntry"
      />
    </UTooltip>

    <UDropdownMenu :items="sortItems">
      <UTooltip :text="`${t('searchSort')}: ${currentSortLabel}`">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-arrow-up-down"
          :trailing-icon="dirIcon"
          :aria-label="t('searchSort')"
        />
      </UTooltip>

      <template #item-trailing="{ item }">
        <UIcon v-if="item.active" :name="dirIcon" class="size-4 text-primary" />
      </template>
    </UDropdownMenu>

    <UPopover>
      <UTooltip :text="t('searchAdvTitle')">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-sliders-horizontal"
          :aria-label="t('searchAdvTitle')"
        />
      </UTooltip>

      <template #content>
        <div class="p-3 flex flex-col gap-2 min-w-48">
          <UCheckbox v-model="caseSensitive" :label="t('searchCase')" />
          <UCheckbox v-model="regex" :label="t('searchRegex')" />
          <UCheckbox v-model="includeProtected" :label="t('searchProtect')" />
        </div>
      </template>
    </UPopover>
  </div>
</template>
