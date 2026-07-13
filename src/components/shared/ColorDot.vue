<script setup lang="ts">
import { computed } from 'vue';
import { COLOR_DISPLAY } from '@/const/colors';
import type { NamedColor } from '@/types';

const props = withDefaults(defineProps<{ color?: string; size?: string }>(), { size: '0.75rem' });

const bg = computed(() =>
  props.color && props.color in COLOR_DISPLAY ? COLOR_DISPLAY[props.color as NamedColor] : 'transparent'
);
</script>

<template>
  <span
    class="inline-block rounded-full border border-default"
    :style="{ width: size, height: size, backgroundColor: bg }"
  />
</template>
