<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@/i18n';

interface Shortcut {
  action: string;
  keys: string[];
}

const shortcuts = computed<Shortcut[]>(() => [
  { action: t('cmdPalette'), keys: ['Ctrl', 'K'] },
  { action: t('setShFind'), keys: ['Ctrl', 'F'] },
  { action: t('setShCreateEntry'), keys: ['Ctrl', 'N'] },
  { action: t('setShCopyPass'), keys: ['Ctrl', 'C'] },
  { action: t('setShCopyUser'), keys: ['Ctrl', 'B'] },
  { action: t('setShLock'), keys: ['Ctrl', 'L'] },
  { action: t('setShGen'), keys: ['Ctrl', 'G'] },
  { action: t('setShSave'), keys: ['Ctrl', 'S'] },
  { action: t('setShSet'), keys: ['Ctrl', ','] }
]);
</script>

<template>
  <div class="flex flex-col gap-6">
    <h1 class="text-xl font-semibold">{{ t('shortcuts') }}</h1>

    <UCard>
      <ul class="flex flex-col divide-y divide-default/60">
        <li
          v-for="sc in shortcuts"
          :key="sc.action"
          class="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
        >
          <span class="text-sm">{{ sc.action }}</span>
          <span class="flex items-center gap-1">
            <template v-for="(key, i) in sc.keys" :key="key">
              <UKbd>{{ key }}</UKbd>
              <span v-if="i < sc.keys.length - 1" class="text-muted text-xs">+</span>
            </template>
          </span>
        </li>
      </ul>
    </UCard>
  </div>
</template>
