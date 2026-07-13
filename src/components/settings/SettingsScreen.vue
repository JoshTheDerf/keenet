<script setup lang="ts">
import { computed } from 'vue';
import { useUiStore } from '@/stores/ui';
import { useVaultStore } from '@/stores/vault';
import { t } from '@/i18n';
import SettingsGeneral from './SettingsGeneral.vue';
import SettingsFiles from './SettingsFiles.vue';
import SettingsStorage from './SettingsStorage.vue';
import SettingsBackup from './SettingsBackup.vue';
import SettingsShortcuts from './SettingsShortcuts.vue';
import SettingsAbout from './SettingsAbout.vue';
import SettingsHelp from './SettingsHelp.vue';

const ui = useUiStore();
const vault = useVaultStore();

interface NavItem {
  key: string;
  label: string;
  icon: string;
}

const nav = computed<NavItem[]>(() => [
  { key: 'general', label: t('menuSetGeneral'), icon: 'i-lucide-settings-2' },
  { key: 'files', label: t('setFilesTitle'), icon: 'i-lucide-database' },
  { key: 'storage', label: t('setStorageTitle'), icon: 'i-lucide-cloud' },
  { key: 'backup', label: t('setFileBackups'), icon: 'i-lucide-archive' },
  { key: 'shortcuts', label: t('shortcuts'), icon: 'i-lucide-keyboard' },
  { key: 'about', label: t('menuSetAbout'), icon: 'i-lucide-info' },
  { key: 'help', label: t('help'), icon: 'i-lucide-life-buoy' }
]);

function select(key: string): void {
  ui.settingsPage = key;
}

function goBack(): void {
  ui.showScreen(vault.hasFiles ? 'app' : 'open');
}
</script>

<template>
  <div class="flex h-full min-h-0">
    <!-- Left sub-nav -->
    <aside class="shrink-0 w-56 border-r border-default bg-muted/30 flex flex-col p-3 gap-1">
      <UButton
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        class="justify-start mb-2"
        block
        :label="t('back')"
        @click="goBack"
      />
      <USeparator class="mb-2" />
      <UButton
        v-for="item in nav"
        :key="item.key"
        :icon="item.icon"
        :color="ui.settingsPage === item.key ? 'primary' : 'neutral'"
        :variant="ui.settingsPage === item.key ? 'soft' : 'ghost'"
        class="justify-start"
        block
        :label="item.label"
        @click="select(item.key)"
      />
    </aside>

    <!-- Right content -->
    <main class="flex-1 min-w-0 overflow-y-auto">
      <div class="max-w-3xl mx-auto p-6">
        <SettingsGeneral v-if="ui.settingsPage === 'general'" />
        <SettingsFiles v-else-if="ui.settingsPage === 'files'" />
        <SettingsStorage v-else-if="ui.settingsPage === 'storage'" />
        <SettingsBackup v-else-if="ui.settingsPage === 'backup'" />
        <SettingsShortcuts v-else-if="ui.settingsPage === 'shortcuts'" />
        <SettingsAbout v-else-if="ui.settingsPage === 'about'" />
        <SettingsHelp v-else-if="ui.settingsPage === 'help'" />
        <SettingsGeneral v-else />
      </div>
    </main>
  </div>
</template>
