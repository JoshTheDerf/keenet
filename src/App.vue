<script setup lang="ts">
import { useUiStore } from '@/stores/ui';
import { useTheme } from '@/composables/useTheme';
import OpenScreen from '@/components/open/OpenScreen.vue';
import AppShell from '@/components/layout/AppShell.vue';
import SettingsScreen from '@/components/settings/SettingsScreen.vue';

const ui = useUiStore();
useTheme();
</script>

<template>
  <UApp>
    <div class="h-full w-full bg-default text-default overflow-hidden">
      <OpenScreen v-if="ui.screen === 'open'" />
      <AppShell v-else-if="ui.screen === 'app'" />
      <SettingsScreen v-else-if="ui.screen === 'settings'" />
    </div>

    <!-- Toasts -->
    <div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80">
      <UAlert
        v-for="toast in ui.toasts"
        :key="toast.id"
        :title="toast.title"
        :description="toast.description"
        :color="toast.color ?? 'info'"
        variant="subtle"
        close
        @update:open="ui.dismiss(toast.id)"
      />
    </div>
  </UApp>
</template>
