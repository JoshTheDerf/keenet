<script setup lang="ts">
/** One settings line: label and help text on the left, a control on the right. */
withDefaults(defineProps<{ label: string; help?: string }>(), { help: '' });
</script>

<template>
  <div class="flex items-start justify-between gap-4">
    <div class="min-w-0">
      <div class="text-sm font-medium">{{ label }}</div>
      <div v-if="help" class="text-xs text-muted">{{ help }}</div>
    </div>
    <div class="shrink-0">
      <slot />
    </div>
  </div>
</template>
