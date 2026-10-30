<script setup lang="ts">
import { computed, useTemplateRef } from 'vue';
import EntryIcon from '@/components/shared/EntryIcon.vue';
import ColorDot from '@/components/shared/ColorDot.vue';
import OtpChip from '@/components/otp/OtpChip.vue';
import { t } from '@/i18n';
import { hostOf } from '@/components/shared/format';
import { useVaultStore } from '@/stores/vault';
import { useClipboard } from '@/composables/useClipboard';
import type { EntryVm } from '@/types';

const props = withDefaults(
  defineProps<{ entry: EntryVm; selected: boolean; table?: boolean }>(),
  { table: false }
);

const emit = defineEmits<{ select: [id: string] }>();

const vault = useVaultStore();
const { copy } = useClipboard();

// copy straight from the list, without opening the entry
function copyUser(): void {
  void copy(vault.resolveReference(props.entry.fileId, props.entry.username), t('user'));
}
function copyPassword(): void {
  void copy(vault.resolveReference(props.entry.fileId, props.entry.password), t('password'), { sensitive: true });
}

const host = computed(() => hostOf(props.entry.url));

const description = computed(() => {
  const parts = [props.entry.username, host.value].filter(Boolean);
  return parts.join(' · ');
});

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'short' });

const updatedLabel = computed(() =>
  props.entry.updated ? dateFmt.format(new Date(props.entry.updated)) : ''
);

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
    class="group kw-selectable max-md:min-h-11 flex items-center gap-3 pl-3 pr-2 py-2 cursor-pointer border-b border-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
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
      <OtpChip v-if="entry.otp && !entry.inTrash" :entry="entry" />
      <UIcon
        v-if="entry.expired"
        name="i-lucide-triangle-alert"
        class="size-4 text-warning"
      />
      <div
        v-if="!entry.inTrash"
        class="flex items-center"
        :class="selected ? '' : 'pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100'"
      >
        <UTooltip v-if="entry.username" :text="t('detCopyField', t('user'))" :kbds="['meta', 'b']">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            icon="i-lucide-user"
            class="pointer-coarse:hidden"
            :aria-label="t('detCopyField', t('user'))"
            tabindex="-1"
            @click.stop="copyUser"
          />
        </UTooltip>
        <UTooltip v-if="entry.password" :text="t('detCopyField', t('password'))" :kbds="['meta', 'c']">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            icon="i-lucide-key-round"
            :aria-label="t('detCopyField', t('password'))"
            tabindex="-1"
            data-testid="copy-password"
            @click.stop="copyPassword"
          />
        </UTooltip>
      </div>
    </div>
  </div>
</template>
