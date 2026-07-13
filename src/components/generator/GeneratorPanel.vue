<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  BUILTIN_PRESETS,
  generatePassword,
  resolveDefaultPreset,
  presetPoolSize,
  estimateEntropyBits,
  CHAR_RANGES,
  type GeneratorPreset,
  type GeneratorRanges
} from '@/domain/generator';
import { t } from '@/i18n';
import { useSettingsStore } from '@/stores/settings';
import { useClipboard } from '@/composables/useClipboard';
import PasswordStrengthBar from '@/components/shared/PasswordStrengthBar.vue';
import TextPromptModal from '@/components/shared/TextPromptModal.vue';

const props = withDefaults(defineProps<{ initialPassword?: string }>(), {
  initialPassword: ''
});

const emit = defineEmits<{ select: [password: string]; close: [] }>();

const settings = useSettingsStore();
const { copy } = useClipboard();

const MIN_LENGTH = 1;
const MAX_LENGTH = 64;

/** Stable identity for a preset ("b:" builtin / "u:" user + name). */
function presetKey(p: GeneratorPreset): string {
  return `${p.builtin ? 'b' : 'u'}:${p.name}`;
}

/** Builtin presets first, then any user-defined ones from settings. */
const allPresets = computed<GeneratorPreset[]>(() => [
  ...BUILTIN_PRESETS,
  ...settings.generatorPresets
]);

// Initialize from the default user preset if one is marked, else the first builtin.
const initialPreset: GeneratorPreset = resolveDefaultPreset(settings.generatorPresets);

/** Working copy of the active preset (cloned so edits never mutate the source). */
const preset = ref<GeneratorPreset>({ ...initialPreset });

/** Currently selected preset identity (may diverge from the working copy). */
const selectedKey = ref<string>(presetKey(initialPreset));

interface PresetOption {
  label: string;
  value: string;
}

/** Localized titles for the builtin presets (user presets keep their names). */
const BUILTIN_TITLE_KEY: Record<string, string> = {
  Default: 'genPresetDefault',
  Pronounceable: 'genPresetPronounceable',
  Med: 'genPresetMed',
  Long: 'genPresetLong',
  Pin4: 'genPresetPin4',
  Mac: 'genPresetMac',
  Hash128: 'genPresetHash128',
  Hash256: 'genPresetHash256'
};

function presetTitle(p: GeneratorPreset): string {
  const key = p.builtin ? BUILTIN_TITLE_KEY[p.name] : undefined;
  return key ? t(key) : p.title;
}

const presetOptions = computed<PresetOption[]>(() =>
  allPresets.value.map((p) => ({
    label: p.default ? `${presetTitle(p)} ${t('genDefaultSuffix')}` : presetTitle(p),
    value: presetKey(p)
  }))
);

const currentSelected = computed<GeneratorPreset | undefined>(() =>
  allPresets.value.find((p) => presetKey(p) === selectedKey.value)
);

const isUserSelected = computed<boolean>(() => currentSelected.value?.builtin === false);
const isDefaultSelected = computed<boolean>(() => currentSelected.value?.default === true);

watch(selectedKey, (key) => {
  const source = allPresets.value.find((p) => presetKey(p) === key);
  if (source) preset.value = { ...source };
});

interface CharsetToggle {
  key: keyof GeneratorRanges;
  labelKey: string;
}

const charsetToggles: CharsetToggle[] = [
  { key: 'upper', labelKey: 'genPsUpper' },
  { key: 'lower', labelKey: 'genPsLower' },
  { key: 'digits', labelKey: 'genPsDigits' },
  { key: 'special', labelKey: 'genPsSpecial' },
  { key: 'brackets', labelKey: 'genPsBrackets' },
  { key: 'high', labelKey: 'genPsHigh' },
  { key: 'ambiguous', labelKey: 'genPsAmbiguous' }
];

// Reference the ranges map so unused-import checks stay happy and the source of
// truth for the toggle set is explicit.
void CHAR_RANGES;

const generated = ref<string>(props.initialPassword || generatePassword(preset.value));

function regenerate(): void {
  generated.value = generatePassword(preset.value);
}

// Auto-regenerate whenever length / charsets / preset change.
watch(preset, regenerate, { deep: true });

const hidden = ref<boolean>(settings.generatorHidePassword);

watch(hidden, (value) => {
  settings.generatorHidePassword = value;
});

const displayValue = computed<string>(() =>
  hidden.value ? '•'.repeat(generated.value.length) : generated.value
);

const poolSize = computed<number>(() => presetPoolSize(preset.value));
const entropyBits = computed<number>(() =>
  estimateEntropyBits(preset.value.length, poolSize.value)
);

// --- User preset management -------------------------------------------------

const savePresetOpen = ref(false);

/** Snapshot the working preset (length + ranges + include) as a user preset. */
function saveAsPreset(name: string): void {
  const snapshot: GeneratorPreset = {
    ...preset.value,
    name,
    title: name,
    pattern: undefined,
    builtin: false,
    default: false
  };

  const existing = settings.generatorPresets.findIndex((p) => p.name === name);
  if (existing >= 0) {
    // Overwrite in place, preserving its default flag.
    snapshot.default = settings.generatorPresets[existing].default;
    settings.generatorPresets.splice(existing, 1, snapshot);
  } else {
    settings.generatorPresets.push(snapshot);
  }
  selectedKey.value = presetKey(snapshot);
}

/** Delete the currently-selected user preset. */
function deletePreset(): void {
  if (!isUserSelected.value) return;
  const idx = settings.generatorPresets.findIndex((p) => presetKey(p) === selectedKey.value);
  if (idx >= 0) settings.generatorPresets.splice(idx, 1);
  selectedKey.value = presetKey(BUILTIN_PRESETS[0]);
}

/**
 * Mark the selected preset as default. Only one default is persisted, on a user
 * preset (builtin default flags are read-only), so selecting a builtin default
 * simply clears any user default and falls back to the first builtin on reopen.
 */
function setAsDefault(): void {
  const cur = currentSelected.value;
  if (!cur) return;
  settings.generatorPresets.forEach((p) => {
    p.default = false;
  });
  if (!cur.builtin) {
    const idx = settings.generatorPresets.findIndex((p) => p.name === cur.name);
    if (idx >= 0) settings.generatorPresets[idx].default = true;
  }
}

// --- Derive from an existing password ---------------------------------------

const deriveInput = ref<string>('');

/** Build a working preset shaped like the pasted password. */
function deriveFromPassword(): void {
  const pw = deriveInput.value;
  if (!pw) return;
  const length = Math.min(Math.max(pw.length, MIN_LENGTH), MAX_LENGTH);
  preset.value = {
    name: 'Derived',
    title: 'Derived',
    length,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    digits: /[0-9]/.test(pw),
    special: /[^a-zA-Z0-9]/.test(pw),
    brackets: false,
    high: false,
    ambiguous: true,
    include: undefined,
    pattern: undefined,
    builtin: false,
    default: false
  };
  // The working copy no longer matches any listed preset.
  selectedKey.value = '';
  deriveInput.value = '';
}

function onCopy(): void {
  if (generated.value) void copy(generated.value, t('password'));
}

function onUse(): void {
  emit('select', generated.value);
}

function onClose(): void {
  emit('close');
}
</script>

<template>
  <div class="flex flex-col gap-4 w-full">
    <!-- Preset selector -->
    <div class="flex flex-col gap-2">
      <USelectMenu
        v-model="selectedKey"
        :items="presetOptions"
        value-key="value"
        label-key="label"
        :placeholder="t('genPresetCustom')"
        class="w-full"
      />
      <div class="flex items-center gap-1">
        <UTooltip :text="t('genSavePresetTooltip')">
          <UButton
            icon="i-lucide-bookmark-plus"
            color="neutral"
            variant="soft"
            size="xs"
            :label="t('setFileSave')"
            @click="savePresetOpen = true"
          />
        </UTooltip>
        <UTooltip :text="isDefaultSelected ? t('genAlreadyDefault') : t('genSetDefault')">
          <UButton
            icon="i-lucide-star"
            color="neutral"
            variant="soft"
            size="xs"
            :label="t('genDefault')"
            :disabled="isDefaultSelected"
            @click="setAsDefault"
          />
        </UTooltip>
        <UTooltip :text="t('genPsDelete')">
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="soft"
            size="xs"
            :disabled="!isUserSelected"
            @click="deletePreset"
          />
        </UTooltip>
      </div>
    </div>

    <!-- Derive from an existing password -->
    <div class="flex flex-col gap-1 rounded-md border border-default p-2">
      <span class="text-xs text-muted">{{ t('genDeriveFromPassword') }}</span>
      <div class="flex items-center gap-1">
        <UInput
          v-model="deriveInput"
          :placeholder="t('genDerivePlaceholder')"
          size="sm"
          class="flex-1"
          @keydown.enter="deriveFromPassword"
        />
        <UTooltip :text="t('genDeriveTooltip')">
          <UButton
            icon="i-lucide-wand-2"
            color="neutral"
            variant="soft"
            size="sm"
            :disabled="!deriveInput"
            @click="deriveFromPassword"
          />
        </UTooltip>
      </div>
    </div>

    <!-- Length -->
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between text-sm">
        <span class="text-muted">{{ t('genLen') }}</span>
        <UInput
          v-model.number="preset.length"
          type="number"
          :min="MIN_LENGTH"
          :max="MAX_LENGTH"
          size="xs"
          class="w-20"
        />
      </div>
      <USlider v-model="preset.length" :min="MIN_LENGTH" :max="MAX_LENGTH" :step="1" />
    </div>

    <!-- Character-set toggles -->
    <div class="grid grid-cols-2 gap-x-3 gap-y-1">
      <UCheckbox
        v-for="tog in charsetToggles"
        :key="tog.key"
        v-model="preset[tog.key]"
        :label="t(tog.labelKey)"
      />
    </div>

    <!-- Generated password -->
    <div class="flex items-center gap-1 rounded-md bg-elevated px-3 py-2">
      <span class="kw-mono flex-1 break-all text-lg leading-tight select-all">{{
        displayValue
      }}</span>
      <UTooltip :text="hidden ? t('genShowPass') : t('genHidePass')">
        <UButton
          :icon="hidden ? 'i-lucide-eye' : 'i-lucide-eye-off'"
          color="neutral"
          variant="ghost"
          size="sm"
          @click="hidden = !hidden"
        />
      </UTooltip>
      <UTooltip :text="t('genNewPass')">
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          size="sm"
          @click="regenerate"
        />
      </UTooltip>
      <UTooltip :text="t('alertCopy')">
        <UButton
          icon="i-lucide-copy"
          color="neutral"
          variant="ghost"
          size="sm"
          @click="onCopy"
        />
      </UTooltip>
    </div>

    <!-- Entropy + strength -->
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between text-xs text-muted">
        <span>{{ t('genEntropy') }}</span>
        <UBadge color="neutral" variant="subtle">{{ t('genEntropyBits', entropyBits) }}</UBadge>
      </div>
      <PasswordStrengthBar :password="generated" />
    </div>

    <!-- Footer -->
    <div class="flex items-center justify-end gap-2">
      <UButton color="neutral" variant="ghost" @click="onClose">{{ t('alertClose') }}</UButton>
      <UButton color="primary" @click="onUse">{{ t('genUse') }}</UButton>
    </div>

    <TextPromptModal
      v-model:open="savePresetOpen"
      :title="t('genSavePreset')"
      :placeholder="t('genPresetName')"
      :confirm-label="t('setFileSave')"
      @confirm="saveAsPreset"
    />
  </div>
</template>
