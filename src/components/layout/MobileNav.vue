<script setup lang="ts">
// Phones: the main places in thumb reach along the bottom edge, plus a
// floating + for the current view (new entry, or scan a one-time code).
import { computed } from 'vue';
import { t } from '@/i18n';
import { useVaultStore } from '@/stores/vault';
import { useUiStore } from '@/stores/ui';
import { useOverlays } from '@/composables/useOverlays';

const vault = useVaultStore();
const ui = useUiStore();
const { otpSetupOpen } = useOverlays();

const codesView = computed(() => vault.selection.type === 'otp');

const items = computed(() => [
  {
    key: 'entries',
    label: t('mobileNavPasswords'),
    icon: 'i-lucide-key-round',
    active: !codesView.value,
    onClick: () => {
      if (codesView.value) vault.setSelection({ type: 'all' });
    }
  },
  {
    key: 'codes',
    label: t('mobileNavCodes'),
    icon: 'i-lucide-timer',
    active: codesView.value,
    onClick: () => vault.setSelection({ type: 'otp' })
  },
  {
    key: 'generator',
    label: t('mobileNavGenerator'),
    icon: 'i-lucide-dices',
    active: false,
    onClick: () => (vault.generatorOpen = true)
  },
  {
    key: 'settings',
    label: t('settings'),
    icon: 'i-lucide-settings',
    active: false,
    onClick: () => ui.openSettings()
  }
]);

function onFab(): void {
  if (codesView.value) otpSetupOpen.value = true;
  else vault.createEntry();
}
</script>

<template>
  <nav
    class="relative shrink-0 border-t border-default bg-elevated/60 backdrop-blur pb-[env(safe-area-inset-bottom)]"
    :aria-label="t('mobileNavLabel')"
    data-testid="mobile-nav"
  >
    <UButton
      v-if="vault.hasFiles"
      color="primary"
      size="xl"
      :icon="codesView ? 'i-lucide-scan-line' : 'i-lucide-plus'"
      class="absolute right-4 bottom-[calc(100%+1rem)] size-14 justify-center rounded-2xl shadow-lg"
      :aria-label="codesView ? t('otpAddTitle') : t('searchAddNew')"
      data-testid="fab"
      @click="onFab"
    />
    <div class="grid grid-cols-4">
      <button
        v-for="item in items"
        :key="item.key"
        type="button"
        class="flex flex-col items-center justify-center gap-0.5 h-16 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
        :class="item.active ? 'text-primary' : 'text-muted'"
        :aria-current="item.active ? 'page' : undefined"
        @click="item.onClick"
      >
        <span
          class="flex items-center justify-center h-8 w-14 rounded-full transition-colors"
          :class="item.active ? 'bg-primary/15' : ''"
        >
          <UIcon :name="item.icon" class="size-6" />
        </span>
        {{ item.label }}
      </button>
    </div>
  </nav>
</template>
