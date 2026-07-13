<script setup lang="ts">
import { computed } from 'vue';
import { useSettingsStore, type ThemeName } from '@/stores/settings';
import { AVAILABLE_LOCALES, setLocale, t } from '@/i18n';

const settings = useSettingsStore();

// ---- Locale --------------------------------------------------------------
const localeItems = Object.entries(AVAILABLE_LOCALES).map(([value, label]) => ({ label, value }));

const localeValue = computed<string>({
  get: () => settings.locale,
  set: (value: string) => {
    settings.locale = value;
    void setLocale(value);
  }
});

// ---- Themes --------------------------------------------------------------
const themes = computed<{ key: ThemeName; label: string }[]>(() => [
  { key: 'dark', label: t('setGenThemeDark') },
  { key: 'light', label: t('setGenThemeLight') },
  { key: 'sd', label: t('setGenThemeSd') },
  { key: 'sl', label: t('setGenThemeSl') },
  { key: 'fb', label: t('setGenThemeFb') },
  { key: 'bl', label: t('setGenThemeBl') },
  { key: 'db', label: t('setGenThemeDb') },
  { key: 'lb', label: t('setGenThemeLb') },
  { key: 'te', label: t('setGenThemeTe') },
  { key: 'lt', label: t('setGenThemeLt') },
  { key: 'hc', label: t('setGenThemeHc') },
  { key: 'dc', label: t('setGenThemeDc') }
]);

function selectTheme(theme: ThemeName): void {
  settings.theme = theme;
}

// ---- Font size -----------------------------------------------------------
const fontSizeItems = computed<{ label: string; value: 0 | 1 | 2 }[]>(() => [
  { label: t('setGenFontSizeNormal'), value: 0 },
  { label: t('setGenFontSizeLarge'), value: 1 },
  { label: t('setGenFontSizeLargest'), value: 2 }
]);

// ---- Toggle groups -------------------------------------------------------
type BoolSetting =
  | 'tableView'
  | 'expandGroups'
  | 'colorfulIcons'
  | 'useMarkdown'
  | 'autoSave'
  | 'lockOnCopy'
  | 'lockOnMinimize'
  | 'auditPasswords'
  | 'generatorHidePassword'
  | 'biometricLock';

interface Toggle {
  key: BoolSetting;
  label: string;
  help: string;
}

const appearanceToggles = computed<Toggle[]>(() => [
  { key: 'tableView', label: t('setGenTableView'), help: t('setGenTableViewHelp') },
  { key: 'expandGroups', label: t('setGenShowSubgroups'), help: t('setGenShowSubgroupsHelp') },
  { key: 'colorfulIcons', label: t('setGenColorfulIcons'), help: t('setGenColorfulIconsHelp') },
  { key: 'useMarkdown', label: t('setGenUseMarkdown'), help: t('setGenUseMarkdownHelp') }
]);

const functionToggles = computed<Toggle[]>(() => [
  { key: 'autoSave', label: t('setGenAutoSyncOnClose'), help: t('setGenAutoSaveHelp') },
  { key: 'lockOnCopy', label: t('setGenLockCopy'), help: t('setGenLockCopyHelp') },
  { key: 'lockOnMinimize', label: t('setGenLockMinimize'), help: t('setGenLockMinimizeHelp') },
  { key: 'biometricLock', label: t('setGenBiometric'), help: t('setGenBiometricHelp') }
]);

const auditToggles = computed<Toggle[]>(() => [
  { key: 'auditPasswords', label: t('setGenAuditPasswords'), help: t('setGenAuditPasswordsHelp') },
  { key: 'generatorHidePassword', label: t('setGenHidePassGen'), help: t('setGenHidePassGenHelp') }
]);

function setNumber(key: 'clipboardSeconds' | 'idleMinutes', value: string | number): void {
  const n = Number(value);
  settings[key] = Number.isFinite(n) && n >= 0 ? n : 0;
}

// ---- Auto-save interval --------------------------------------------------
const autoSaveIntervalItems = computed<{ label: string; value: number }[]>(() => [
  { label: t('setGenAutoSyncTimerOff'), value: 0 },
  { label: t('setGenEveryMinute'), value: 1 },
  { label: t('setGenEveryMinutes', 5), value: 5 },
  { label: t('setGenEveryMinutes', 15), value: 15 },
  { label: t('setGenEveryMinutes', 30), value: 30 },
  { label: t('setGenEveryMinutes', 60), value: 60 }
]);
</script>

<template>
  <div class="flex flex-col gap-6">
    <h1 class="text-xl font-semibold">{{ t('setGenTitle') }}</h1>

    <!-- Appearance -->
    <UCard>
      <template #header>
        <h2 class="text-base font-semibold">{{ t('setGenAppearance') }}</h2>
      </template>

      <div class="flex flex-col gap-5">
        <!-- Locale -->
        <div>
          <label class="text-sm font-medium">{{ t('setGenLocale') }}</label>
          <USelect v-model="localeValue" :items="localeItems" class="mt-1 w-64" />
        </div>

        <!-- Theme -->
        <div>
          <label class="text-sm font-medium">{{ t('setGenTheme') }}</label>
          <div class="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
            <button
              v-for="th in themes"
              :key="th.key"
              type="button"
              class="rounded-md border px-3 py-2 text-sm text-left transition-colors"
              :class="
                settings.theme === th.key
                  ? 'border-primary ring-2 ring-primary/40 bg-primary/10 font-medium'
                  : 'border-default hover:bg-elevated/50'
              "
              @click="selectTheme(th.key)"
            >
              <span class="flex items-center justify-between gap-2">
                {{ th.label }}
                <UIcon
                  v-if="settings.theme === th.key"
                  name="i-lucide-check"
                  class="text-primary shrink-0"
                />
              </span>
            </button>
          </div>
        </div>

        <!-- Auto dark/light -->
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="text-sm font-medium">{{ t('setGenAutoTheme') }}</div>
            <div class="text-xs text-muted">{{ t('setGenAutoSwitchTheme') }}</div>
          </div>
          <USwitch v-model="settings.autoSwitchTheme" />
        </div>

        <!-- Font size -->
        <div>
          <label class="text-sm font-medium">{{ t('setGenFontSize') }}</label>
          <USelect v-model="settings.fontSize" :items="fontSizeItems" class="mt-1 w-64" />
        </div>

        <!-- Appearance toggles -->
        <div class="flex flex-col divide-y divide-default/60">
          <div
            v-for="item in appearanceToggles"
            :key="item.key"
            class="flex items-start justify-between gap-4 py-3"
          >
            <div>
              <div class="text-sm font-medium">{{ item.label }}</div>
              <div class="text-xs text-muted">{{ item.help }}</div>
            </div>
            <USwitch v-model="settings[item.key]" />
          </div>
        </div>
      </div>
    </UCard>

    <!-- Function -->
    <UCard>
      <template #header>
        <h2 class="text-base font-semibold">{{ t('setGenFunction') }}</h2>
      </template>

      <div class="flex flex-col gap-5">
        <div class="flex flex-col divide-y divide-default/60">
          <div
            v-for="item in functionToggles"
            :key="item.key"
            class="flex items-start justify-between gap-4 py-3"
          >
            <div>
              <div class="text-sm font-medium">{{ item.label }}</div>
              <div class="text-xs text-muted">{{ item.help }}</div>
            </div>
            <USwitch v-model="settings[item.key]" />
          </div>
        </div>

        <!-- Auto-save interval -->
        <div>
          <label class="text-sm font-medium">{{ t('setGenAutoSyncTimer') }}</label>
          <div class="text-xs text-muted mb-1">{{ t('setGenAutoSyncTimerHelp') }}</div>
          <USelect v-model="settings.autoSaveInterval" :items="autoSaveIntervalItems" class="w-64" />
        </div>

        <!-- Clipboard clear -->
        <div>
          <label class="text-sm font-medium">{{ t('setGenClearClip') }}</label>
          <div class="text-xs text-muted mb-1">{{ t('setGenClearClipHelp') }}</div>
          <UInput
            type="number"
            :min="0"
            :model-value="settings.clipboardSeconds"
            class="w-40"
            @update:model-value="setNumber('clipboardSeconds', $event)"
          />
        </div>

        <!-- Idle lock -->
        <div>
          <label class="text-sm font-medium">{{ t('setGenLockInactive') }}</label>
          <div class="text-xs text-muted mb-1">{{ t('setGenLockInactiveHelp') }}</div>
          <UInput
            type="number"
            :min="0"
            :model-value="settings.idleMinutes"
            class="w-40"
            @update:model-value="setNumber('idleMinutes', $event)"
          />
        </div>
      </div>
    </UCard>

    <!-- Audit -->
    <UCard>
      <template #header>
        <h2 class="text-base font-semibold">{{ t('setGenAudit') }}</h2>
      </template>

      <div class="flex flex-col divide-y divide-default/60">
        <div
          v-for="item in auditToggles"
          :key="item.key"
          class="flex items-start justify-between gap-4 py-3"
        >
          <div>
            <div class="text-sm font-medium">{{ item.label }}</div>
            <div class="text-xs text-muted">{{ item.help }}</div>
          </div>
          <USwitch v-model="settings[item.key]" />
        </div>
      </div>
    </UCard>
  </div>
</template>
