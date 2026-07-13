<script setup lang="ts">
import { ref } from 'vue';
import { ALL_COLORS } from '@/const/colors';
import { t } from '@/i18n';
import ColorDot from '@/components/shared/ColorDot.vue';

const props = defineProps<{ color?: string }>();
const emit = defineEmits<{ select: [color: string | undefined] }>();

const open = ref(false);

function choose(color: string | undefined): void {
  emit('select', color);
  open.value = false;
}

/** Localized name of a named entry color (e.g. "red" → t('colorRed')). */
function colorLabel(color: string): string {
  return t(`color${color[0].toUpperCase()}${color.slice(1)}`);
}
</script>

<template>
  <UPopover v-model:open="open">
    <UTooltip :text="t('detSetIconColor')">
      <UButton color="neutral" variant="ghost" :aria-label="t('detSetIconColor')" class="p-1.5">
        <ColorDot :color="props.color" size="1rem" />
      </UButton>
    </UTooltip>

    <template #content>
      <div class="p-2 flex items-center gap-1.5">
        <UTooltip :text="t('detNoColor')">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-ban"
            size="sm"
            :aria-label="t('detNoColor')"
            @click="choose(undefined)"
          />
        </UTooltip>
        <button
          v-for="c in ALL_COLORS"
          :key="c"
          type="button"
          class="rounded-full p-0.5 hover:ring-2 hover:ring-primary"
          :class="{ 'ring-2 ring-primary': c === props.color }"
          :aria-label="colorLabel(c)"
          @click="choose(c)"
        >
          <ColorDot :color="c" size="1.1rem" />
        </button>
      </div>
    </template>
  </UPopover>
</template>
