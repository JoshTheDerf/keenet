<script setup lang="ts">
// Countdown ring for a time-based code; turns amber in the last few seconds so
// you know to wait for the next code rather than type one about to expire.
import { computed } from 'vue';

const props = withDefaults(defineProps<{ fraction: number; seconds: number; size?: number; label?: boolean }>(), {
  size: 20,
  label: false
});

const R = 9;
const C = 2 * Math.PI * R;
const urgent = computed(() => props.seconds <= 5);
const dash = computed(() => `${(Math.max(0, Math.min(1, props.fraction)) * C).toFixed(2)} ${C.toFixed(2)}`);
</script>

<template>
  <span class="relative inline-flex items-center justify-center shrink-0" :style="{ width: `${size}px`, height: `${size}px` }" :title="`${seconds}s`">
    <svg viewBox="0 0 22 22" class="size-full -rotate-90" aria-hidden="true">
      <circle cx="11" cy="11" :r="R" fill="none" stroke="var(--ui-border-accented)" stroke-width="2.5" />
      <circle
        cx="11"
        cy="11"
        :r="R"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        :stroke-dasharray="dash"
        :class="urgent ? 'text-warning' : 'text-primary'"
      />
    </svg>
    <span v-if="label" class="absolute text-[10px] font-medium tabular-nums" :class="urgent ? 'text-warning' : 'text-muted'">{{ seconds }}</span>
    <span class="sr-only">{{ seconds }}s</span>
  </span>
</template>
