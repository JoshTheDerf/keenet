<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useClipboard } from '@/composables/useClipboard';
import { useVaultStore } from '@/stores/vault';
import { hasFieldReferences } from '@/domain/references';

const props = withDefaults(
  defineProps<{
    label: string;
    modelValue: string;
    icon?: string;
    placeholder?: string;
    copyable?: boolean;
    copyLabel?: string;
    multiline?: boolean;
    type?: string;
    /** when set, `{REF:...}` values are resolved for display/copy */
    fileId?: string;
    /** the value is a password / protected field — honors lock-on-copy */
    sensitive?: boolean;
  }>(),
  { copyable: false, multiline: false, type: 'text', sensitive: false }
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

function commit(): void {
  if (local.value !== props.modelValue) emit('commit', local.value);
}

function onCopy(): void {
  void copy(resolved.value, props.copyLabel ?? props.label, { sensitive: props.sensitive });
}
</script>

<template>
  <UFormField :label="label">
    <div class="flex items-start gap-1.5">
      <UTextarea
        v-if="multiline"
        v-model="local"
        :placeholder="placeholder"
        :rows="3"
        autoresize
        class="flex-1 min-w-0"
        @blur="commit"
      />
      <UInput
        v-else
        v-model="local"
        :type="type"
        :icon="icon"
        :placeholder="placeholder"
        autocomplete="off"
        spellcheck="false"
        class="flex-1 min-w-0"
        @blur="commit"
        @keydown.enter="commit"
      />

      <UTooltip v-if="hasRef" :text="resolved">
        <UBadge color="neutral" variant="soft" icon="i-lucide-link" size="sm">ref</UBadge>
      </UTooltip>

      <slot name="actions" />

      <UTooltip v-if="copyable" :text="`Copy ${copyLabel ?? label}`">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-copy"
          :aria-label="`Copy ${copyLabel ?? label}`"
          :disabled="!modelValue"
          @click="onCopy"
        />
      </UTooltip>
    </div>
  </UFormField>
</template>
