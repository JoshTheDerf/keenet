<script setup lang="ts">
import { ref } from 'vue';
import { KEEPASS_ICON_TO_LUCIDE, iconClass } from '@/const/icons';
import { t } from '@/i18n';
import EntryIcon from '@/components/shared/EntryIcon.vue';

const props = defineProps<{ icon: number; color?: string }>();
const emit = defineEmits<{ select: [icon: number] }>();

const open = ref(false);
const indices = KEEPASS_ICON_TO_LUCIDE.map((_, i) => i);

function choose(index: number): void {
  emit('select', index);
  open.value = false;
}
</script>

<template>
  <UPopover v-model:open="open">
    <UTooltip :text="t('detSetIcon')">
      <UButton color="neutral" variant="ghost" :aria-label="t('detSetIcon')" class="p-1.5">
        <EntryIcon :icon="props.icon" :color="props.color" size="1.75rem" />
      </UButton>
    </UTooltip>

    <template #content>
      <div class="p-2 grid grid-cols-8 gap-1 max-w-72 max-h-64 overflow-y-auto">
        <UButton
          v-for="i in indices"
          :key="i"
          color="neutral"
          :variant="i === props.icon ? 'soft' : 'ghost'"
          :icon="iconClass(i)"
          size="sm"
          :aria-label="`${t('icon')} ${i}`"
          @click="choose(i)"
        />
      </div>
    </template>
  </UPopover>
</template>
