<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { t } from '@/i18n';
import { useSettingsStore } from '@/stores/settings';
import { renderMarkdown, looksLikeMarkdown } from '@/domain/markdown';

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ commit: [value: string] }>();

const settings = useSettingsStore();

const local = ref(props.modelValue);
// Default to rendered view when markdown is enabled and the notes look like it.
const editing = ref(
  !(settings.useMarkdown && props.modelValue.length > 0 && looksLikeMarkdown(props.modelValue))
);

watch(
  () => props.modelValue,
  (v) => {
    local.value = v;
  }
);

const rendered = computed(() => renderMarkdown(props.modelValue));
const canPreview = computed(() => settings.useMarkdown);

function commit(): void {
  if (local.value !== props.modelValue) emit('commit', local.value);
}

function edit(): void {
  editing.value = true;
}

function preview(): void {
  commit();
  editing.value = false;
}
</script>

<template>
  <UFormField :label="t('notes')">
    <div class="flex items-start gap-1.5">
      <div class="flex-1 min-w-0">
        <UTextarea
          v-if="editing || !canPreview"
          v-model="local"
          :rows="3"
          autoresize
          class="w-full"
          @blur="commit"
        />
        <div
          v-else
          class="text-sm [&_a]:text-primary [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_h1]:font-semibold whitespace-pre-wrap min-h-8 cursor-text rounded-md px-3 py-2 ring ring-default"
          @click="edit"
          v-html="rendered"
        />
      </div>

      <UTooltip v-if="canPreview" :text="editing ? t('preview') : t('edit')">
        <UButton
          color="neutral"
          variant="ghost"
          :icon="editing ? 'i-lucide-eye' : 'i-lucide-pencil'"
          :aria-label="editing ? t('preview') : t('edit')"
          @click="editing ? preview() : edit()"
        />
      </UTooltip>
    </div>
  </UFormField>
</template>
