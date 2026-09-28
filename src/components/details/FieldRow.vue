<script setup lang="ts">
/** A single-line entry field (user, website) with a copy button. */
import { ref, computed, watch } from 'vue';
import { t } from '@/i18n';
import { useClipboard } from '@/composables/useClipboard';
import { useVaultStore } from '@/stores/vault';
import { hasFieldReferences } from '@/domain/references';

const props = withDefaults(
  defineProps<{
    label: string;
    modelValue: string;
    icon?: string;
    /** when set, `{REF:...}` values are resolved for display/copy */
    fileId?: string;
  }>(),
  { icon: undefined, fileId: undefined }
);

const emit = defineEmits<{ commit: [value: string] }>();

const { copy } = useClipboard();
const vault = useVaultStore();
const local = ref(props.modelValue);

watch(
  () => props.modelValue,
  (v) => {
    local.value = v;
  }
);

const hasRef = computed(() => !!props.fileId && hasFieldReferences(props.modelValue));
const resolved = computed(() =>
  hasRef.value ? vault.resolveReference(props.fileId as string, props.modelValue) : props.modelValue
);

const copyText = computed(() => t('detCopyField', props.label));

function commit(): void {
  if (local.value !== props.modelValue) emit('commit', local.value);
}

function onCopy(): void {
  void copy(resolved.value, props.label);
}
</script>

<template>
  <UFormField :label="label">
    <div class="flex items-start gap-1.5">
      <UInput
        v-model="local"
        :icon="icon"
        autocomplete="off"
        spellcheck="false"
        class="flex-1 min-w-0"
        @blur="commit"
        @keydown.enter="commit"
      />

      <UTooltip v-if="hasRef" :text="resolved">
        <UBadge color="neutral" variant="soft" icon="i-lucide-link" size="sm">{{ t('detRefBadge') }}</UBadge>
      </UTooltip>

      <slot name="actions" />

      <UTooltip :text="copyText">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-copy"
          :aria-label="copyText"
          :disabled="!modelValue"
          @click="onCopy"
        />
      </UTooltip>
    </div>
  </UFormField>
</template>
