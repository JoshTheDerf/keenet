<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { t } from '@/i18n';
import { useClipboard } from '@/composables/useClipboard';
import { useVaultStore } from '@/stores/vault';
import { useSettingsStore } from '@/stores/settings';
import { generatePassword, resolveDefaultPreset } from '@/domain/generator';
import { hasFieldReferences } from '@/domain/references';
import PasswordStrengthBar from '@/components/shared/PasswordStrengthBar.vue';

const props = defineProps<{
  modelValue: string;
  userInputs?: string[];
  /** when set, `{REF:...}` values are resolved on copy */
  fileId?: string;
}>();

const emit = defineEmits<{ commit: [value: string] }>();

const { copy } = useClipboard();
const vault = useVaultStore();
const settings = useSettingsStore();

const local = ref(props.modelValue);
const revealed = ref(false);

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
  void copy(resolved.value, t('password'), { sensitive: true });
}

function generate(): void {
  local.value = generatePassword(resolveDefaultPreset(settings.generatorPresets));
  revealed.value = true;
  commit();
}
</script>

<template>
  <UFormField :label="t('password')">
    <div class="flex items-center gap-1.5">
      <UInput
        v-model="local"
        :type="revealed ? 'text' : 'password'"
        icon="i-lucide-key-round"
        autocomplete="off"
        spellcheck="false"
        class="flex-1 min-w-0 font-mono"
        @blur="commit"
        @keydown.enter="commit"
      />

      <UTooltip v-if="hasRef" :text="resolved">
        <UBadge color="neutral" variant="soft" icon="i-lucide-link" size="sm">ref</UBadge>
      </UTooltip>

      <UTooltip :text="revealed ? t('genHidePass') : t('genShowPass')">
        <UButton
          color="neutral"
          variant="ghost"
          :icon="revealed ? 'i-lucide-eye-off' : 'i-lucide-eye'"
          :aria-label="revealed ? t('genHidePass') : t('genShowPass')"
          @click="revealed = !revealed"
        />
      </UTooltip>

      <UTooltip :text="t('footerTitleGen')">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-dice-5"
          :aria-label="t('footerTitleGen')"
          @click="generate"
        />
      </UTooltip>

      <UTooltip :text="t('footerTitleGen')">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-sliders-horizontal"
          :aria-label="t('footerTitleGen')"
          @click="vault.generatorOpen = true"
        />
      </UTooltip>

      <UTooltip :text="`Copy ${t('password')}`">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-copy"
          :aria-label="`Copy ${t('password')}`"
          :disabled="!modelValue"
          @click="onCopy"
        />
      </UTooltip>
    </div>

    <PasswordStrengthBar :password="local" :user-inputs="userInputs" class="mt-2" />
  </UFormField>
</template>
