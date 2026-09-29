<script setup lang="ts">
import type { ButtonProps } from '@nuxt/ui';
import { useUiStore, type Toast } from '@/stores/ui';
import { useTheme } from '@/composables/useTheme';
import OpenScreen from '@/components/open/OpenScreen.vue';
import AppShell from '@/components/layout/AppShell.vue';
import SettingsScreen from '@/components/settings/SettingsScreen.vue';

const ui = useUiStore();
useTheme();

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
    <div class="fixed inset-x-4 bottom-4 z-50 flex flex-col gap-2 sm:left-auto sm:w-80">
      <UAlert
        v-for="toast in ui.toasts"
        :key="toast.id"
        :title="toast.title"
        :description="toast.description"
        :color="toast.color ?? 'info'"
        :actions="toastActions(toast)"
        variant="subtle"
        close
        @update:open="ui.dismiss(toast.id)"
      />
    </div>
  </UApp>
</template>
