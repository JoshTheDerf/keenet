<script setup lang="ts">
import { computed } from 'vue';
import { iconClass } from '@/const/icons';
import { COLOR_DISPLAY } from '@/const/colors';
import type { NamedColor } from '@/types';

const props = withDefaults(
  defineProps<{ icon: number; color?: string; size?: string }>(),
  { size: '1rem' }
);

const cls = computed(() => iconClass(props.icon));
const style = computed(() => {
  const c = props.color && props.color in COLOR_DISPLAY ? COLOR_DISPLAY[props.color as NamedColor] : undefined;
  return { color: c, fontSize: props.size, width: props.size, height: props.size };
});
</script>

<template>
  <UIcon :name="cls" :style="style" class="shrink-0" />
</template>
