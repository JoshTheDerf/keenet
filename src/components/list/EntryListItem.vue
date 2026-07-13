<script setup lang="ts">
import { computed, useTemplateRef } from 'vue';
import EntryIcon from '@/components/shared/EntryIcon.vue';
import ColorDot from '@/components/shared/ColorDot.vue';
import { t } from '@/i18n';
import type { EntryVm } from '@/types';

const props = withDefaults(
  defineProps<{ entry: EntryVm; selected: boolean; table?: boolean }>(),
  { table: false }
);

const emit = defineEmits<{ select: [id: string] }>();

function hostOf(url: string): string {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    try {
      return new URL(`https://${url}`).host;
    } catch {
      return url;
    }
  }
}

const host = computed(() => hostOf(props.entry.url));

const description = computed(() => {
  const parts = [props.entry.username, host.value].filter(Boolean);
  return parts.join(' · ');
});

function formatDate(ms: number): string {
  if (!ms) return '';
  const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'short' });
  return fmt.format(new Date(ms));
}

const updatedLabel = computed(() => formatDate(props.entry.updated));

function onSelect(): void {
  emit('select', props.entry.id);
}

const root = useTemplateRef<HTMLElement>('root');

defineExpose({
  /** Roving focus: the list moves focus here when this item becomes selected. */
  focus(): void {
    root.value?.focus();
  }
});
</script>

<template>
  <!-- Table mode -->
  <div
    v-if="table"
    ref="root"
    class="kw-selectable max-md:min-h-11 grid grid-cols-[2fr_1.5fr_1.5fr_auto] items-center gap-2 px-3 py-2 cursor-pointer border-b border-default text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
    :class="selected ? 'bg-primary/10 text-highlighted' : 'hover:bg-elevated/50'"
    role="row"
    :tabindex="selected ? 0 : -1"
    :aria-selected="selected"
    @click="onSelect"
    @keydown.enter.prevent="onSelect"
  >
    <div class="flex items-center gap-2 min-w-0" role="cell">
      <EntryIcon :icon="entry.icon" :color="entry.color" />
      <span class="truncate" :class="entry.title ? 'font-medium' : 'text-muted italic'">
        {{ entry.title || `(${t('noTitle')})` }}
      </span>
    </div>
    <span class="truncate text-muted" role="cell">{{ entry.username }}</span>
    <span class="truncate text-muted" role="cell">{{ host }}</span>
    <span class="text-muted whitespace-nowrap tabular-nums" role="cell">{{ updatedLabel }}</span>
  </div>

  <!-- List mode -->
  <div
    v-else
    ref="root"
    class="kw-selectable max-md:min-h-11 flex items-center gap-3 px-3 py-2 cursor-pointer border-b border-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
    :class="selected ? 'bg-primary/10' : 'hover:bg-elevated/50'"
    role="option"
    :tabindex="selected ? 0 : -1"
    :aria-selected="selected"
    @click="onSelect"
    @keydown.enter.prevent="onSelect"
  >
    <EntryIcon :icon="entry.icon" :color="entry.color" size="1.5rem" />

    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-1.5">
        <span
          class="truncate"
          :class="entry.title ? 'font-semibold text-highlighted' : 'text-muted italic'"
        >
          {{ entry.title || `(${t('noTitle')})` }}
        </span>
        <ColorDot v-if="entry.color" :color="entry.color" size="0.6rem" />
      </div>
      <div class="truncate text-sm text-muted">
        {{ description || '\u00A0' }}
      </div>
    </div>

    <div class="flex items-center gap-1 shrink-0">
      <UBadge
        v-if="entry.attachments.length"
        color="neutral"
        variant="soft"
        size="sm"
        icon="i-lucide-paperclip"
        :label="String(entry.attachments.length)"
      />
      <UIcon v-if="entry.otp" name="i-lucide-clock" class="size-4 text-muted" />
      <UIcon
        v-if="entry.expired"
        name="i-lucide-triangle-alert"
        class="size-4 text-warning"
      />
    </div>
  </div>
</template>
