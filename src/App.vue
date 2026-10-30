<script setup lang="ts">
import type { ButtonProps } from '@nuxt/ui';
import { useUiStore, type Toast } from '@/stores/ui';
import { useTheme } from '@/composables/useTheme';
import OpenScreen from '@/components/open/OpenScreen.vue';
import AppShell from '@/components/layout/AppShell.vue';
import SettingsScreen from '@/components/settings/SettingsScreen.vue';
import { useVaultStore } from '@/stores/vault';
import { useBackLayer, trackDialogs } from '@/composables/useBackNavigation';

const ui = useUiStore();
const vault = useVaultStore();
useTheme();

trackDialogs();

// System back leaves settings, or the open screen when databases are open
useBackLayer(
  () => ui.screen === 'settings',
  () => ui.showScreen(vault.hasFiles ? 'app' : 'open')
);
useBackLayer(
  () => ui.screen === 'open' && vault.hasFiles,
  () => ui.showScreen('app')
);

function toastActions(toast: Toast): ButtonProps[] | undefined {
  const action = toast.action;
  if (!action) return undefined;
  return [
    {
      label: action.label,
      color: 'neutral',
      variant: 'outline',
      size: 'xs',
      onClick: () => {
        ui.dismiss(toast.id);
        action.onClick();
      }
    }
  ];
}
</script>

<template>
  <UApp>
    <div class="h-full w-full bg-default text-default overflow-hidden">
      <OpenScreen v-if="ui.screen === 'open'" />
      <AppShell v-else-if="ui.screen === 'app'" />
      <SettingsScreen v-else-if="ui.screen === 'settings'" />
    </div>

    <!-- Toasts -->
    <!-- phones: under the title bar, clear of the bottom bar and the + button -->
    <div
      class="fixed inset-x-4 z-50 flex flex-col gap-2 max-sm:top-[calc(env(safe-area-inset-top)+3.5rem)] sm:bottom-4 sm:left-auto sm:w-80"
    >
      <UAlert
        v-for="toast in ui.toasts"
        :key="toast.id"
        :title="toast.title"
        :description="toast.description"
        :color="toast.color ?? 'info'"
        :actions="toastActions(toast)"
        variant="subtle"
        class="bg-default shadow-lg"
        :ui="{ title: 'first-letter:uppercase' }"
        close
        @update:open="ui.dismiss(toast.id)"
      />
    </div>
  </UApp>
</template>
