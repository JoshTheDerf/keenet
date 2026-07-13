<script setup lang="ts">
import { ref } from 'vue';
import { t } from '@/i18n';
import { useVaultStore } from '@/stores/vault';
import { useClipboard } from '@/composables/useClipboard';

const props = defineProps<{ fileId: string; entryId: string; urls: string[] }>();

const vault = useVaultStore();
const { copy } = useClipboard();

const draft = ref('');

function commit(urls: string[]): void {
  vault.setExtraUrls(props.fileId, props.entryId, urls);
}

function open(url: string): void {
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
}

function remove(index: number): void {
  const next = props.urls.slice();
  next.splice(index, 1);
  commit(next);
}

function update(index: number, value: string): void {
  const next = props.urls.slice();
  next[index] = value;
  commit(next);
}

function add(): void {
  const url = draft.value.trim();
  if (!url) return;
  commit([...props.urls, url]);
  draft.value = '';
}
</script>

<template>
  <UFormField :label="t('detMenuAddNewWebsite')">
    <div class="flex flex-col gap-1.5">
      <div v-for="(url, index) in urls" :key="index" class="flex items-center gap-1.5">
        <UInput
          :model-value="url"
          icon="i-lucide-globe"
          autocomplete="off"
          spellcheck="false"
          class="flex-1 min-w-0"
          @blur="(e: FocusEvent) => update(index, (e.target as HTMLInputElement).value)"
          @keydown.enter="(e: KeyboardEvent) => update(index, (e.target as HTMLInputElement).value)"
        />
        <UTooltip :text="t('detOpenWebsite')">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-external-link"
            :aria-label="t('detOpenWebsite')"
            :disabled="!url"
            @click="open(url)"
          />
        </UTooltip>
        <UTooltip :text="t('website')">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-copy"
            :aria-label="`Copy ${t('website')}`"
            :disabled="!url"
            @click="copy(url, t('website'))"
          />
        </UTooltip>
        <UTooltip :text="t('remove')">
          <UButton
            color="error"
            variant="ghost"
            icon="i-lucide-trash-2"
            :aria-label="t('remove')"
            @click="remove(index)"
          />
        </UTooltip>
      </div>

      <div class="flex items-center gap-1.5">
        <UInput
          v-model="draft"
          icon="i-lucide-plus"
          :placeholder="t('detMenuAddNewWebsite')"
          autocomplete="off"
          spellcheck="false"
          class="flex-1 min-w-0"
          @keydown.enter="add"
        />
        <UButton
          color="neutral"
          variant="soft"
          icon="i-lucide-plus"
          :disabled="!draft.trim()"
          :aria-label="t('detMenuAddNewWebsite')"
          @click="add"
        />
      </div>
    </div>
  </UFormField>
</template>
