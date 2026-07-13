<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted, useTemplateRef } from 'vue';
import { useMediaQuery } from '@vueuse/core';
import { t } from '@/i18n';
import { useVaultStore } from '@/stores/vault';
import { isDesktop, desktop } from '@/composables/useDesktop';
import { runAutoType, type AutoTypeContext } from '@/domain/auto-type';
import TitleBar from '@/components/layout/TitleBar.vue';
import SideMenu from '@/components/menu/SideMenu.vue';
import SearchBar from '@/components/list/SearchBar.vue';
import EntryList from '@/components/list/EntryList.vue';
import EntryDetails from '@/components/details/EntryDetails.vue';
import GeneratorPanel from '@/components/generator/GeneratorPanel.vue';
import CommandPalette from '@/components/layout/CommandPalette.vue';
import { useClipboard } from '@/composables/useClipboard';
import { useAutoSave } from '@/composables/useAutoSave';
import { useLock } from '@/composables/useLock';
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts';

const vault = useVaultStore();
const { copy } = useClipboard();
useAutoSave();
useLock();
useKeyboardShortcuts();

// On mobile the three panes don't fit side-by-side, so we show one at a time:
// the menu is a slide-in drawer; the list and the details pane swap based on
// whether an entry is selected.
const isMobile = useMediaQuery('(max-width: 767px)');
const menuOpen = ref(false);
const drawer = useTemplateRef<HTMLElement>('drawer');

// Focus the drawer when it opens so Escape works and screen readers land in it.
watch(menuOpen, async (isOpen) => {
  if (isOpen && isMobile.value) {
    await nextTick();
    drawer.value?.focus();
  }
});

const showDetailsMobile = computed(() => !!vault.selectedEntryId);
const showListMobile = computed(() => !vault.selectedEntryId);

// Selecting anything in the menu closes the drawer and returns to the list.
watch(
  () => vault.selection,
  () => {
    menuOpen.value = false;
  },
  { deep: true }
);

function onGeneratorSelect(pw: string): void {
  copy(pw, t('password'));
  vault.generatorOpen = false;
}

function backToList(): void {
  vault.selectEntry(null);
}

// Desktop: a global shortcut asks us to auto-type the selected entry.
let unsubAutoType: (() => void) | undefined;
onMounted(() => {
  if (!isDesktop()) return;
  unsubAutoType = desktop()?.on('auto-type-request', () => {
    const entry = vault.selectedEntry;
    if (!entry) return;
    const ctx: AutoTypeContext = {
      title: entry.title,
      username: vault.resolveReference(entry.fileId, entry.username),
      password: vault.resolveReference(entry.fileId, entry.password),
      url: entry.url,
      notes: entry.notes,
      fields: Object.fromEntries(entry.fields.map((f) => [f.name, f.value]))
    };
    void runAutoType(vault.getEffectiveAutoTypeSeq(entry.fileId, entry.id), ctx);
  });
});
onUnmounted(() => unsubAutoType?.());
</script>

<template>
  <div class="flex flex-col h-full">
    <TitleBar @toggle-menu="menuOpen = !menuOpen" />

    <div class="relative flex flex-1 min-h-0">
      <!-- Left menu: static column on desktop, slide-in drawer on mobile -->
      <aside
        ref="drawer"
        tabindex="-1"
        class="bg-elevated border-r border-default overflow-y-auto z-40 w-64 shrink-0 md:static md:w-60 md:translate-x-0 fixed inset-y-0 left-0 transition-transform duration-200 outline-none"
        :class="menuOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full md:translate-x-0'"
        @keydown.escape="menuOpen = false"
      >
        <SideMenu />
      </aside>

      <!-- Mobile drawer backdrop -->
      <div
        v-if="menuOpen"
        class="fixed inset-0 bg-black/40 z-30 md:hidden"
        @click="menuOpen = false"
      />

      <!-- Entry list -->
      <section
        class="border-r border-default flex-col min-h-0 md:flex md:w-[340px] md:shrink-0"
        :class="isMobile ? (showListMobile ? 'flex w-full' : 'hidden') : 'flex'"
      >
        <SearchBar />
        <div class="flex-1 min-h-0 overflow-y-auto">
          <EntryList />
        </div>
      </section>

      <!-- Details -->
      <section
        class="min-w-0 overflow-y-auto md:flex-1 md:block"
        :class="isMobile ? (showDetailsMobile ? 'block w-full' : 'hidden') : 'block flex-1'"
      >
        <!-- Mobile-only back bar -->
        <div class="md:hidden sticky top-0 z-10 bg-default/80 backdrop-blur border-b border-default px-2 py-2">
          <UButton
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            :label="t('back')"
            @click="backToList"
          />
        </div>
        <EntryDetails :key="vault.selectedEntryId ?? 'none'" />
      </section>
    </div>

    <!-- Ctrl/Cmd+K command palette -->
    <CommandPalette />

    <!-- Standalone generator -->
    <UModal v-model:open="vault.generatorOpen" :title="t('cmdGeneratePassword')">
      <template #body>
        <GeneratorPanel @select="onGeneratorSelect" @close="vault.generatorOpen = false" />
      </template>
    </UModal>
  </div>
</template>
