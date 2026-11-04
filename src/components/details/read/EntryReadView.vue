<script setup lang="ts">
// Touchscreens: an entry reads like a card of values, each a tap to copy,
// instead of a form whose fields pop the keyboard up. Editing is one tap away.
import { computed } from 'vue';
import { t } from '@/i18n';
import { useVaultStore } from '@/stores/vault';
import { useSettingsStore } from '@/stores/settings';
import { renderMarkdown, looksLikeMarkdown } from '@/domain/markdown';
import type { EntryVm } from '@/types';
import ReadRow from '@/components/details/read/ReadRow.vue';
import OtpField from '@/components/details/OtpField.vue';
import AttachmentsList from '@/components/details/AttachmentsList.vue';
import { useClipboard } from '@/composables/useClipboard';

const props = defineProps<{ entry: EntryVm }>();

const vault = useVaultStore();
const settings = useSettingsStore();
const { copy } = useClipboard();

const resolve = (v: string) => vault.resolveReference(props.entry.fileId, v);
const user = computed(() => resolve(props.entry.username));
const password = computed(() => resolve(props.entry.password));
const url = computed(() => resolve(props.entry.url));

const notesHtml = computed(() =>
  settings.useMarkdown && looksLikeMarkdown(props.entry.notes) ? renderMarkdown(props.entry.notes) : ''
);

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

function open(link: string): void {
  window.open(/^[a-z][a-z0-9+.-]*:/i.test(link) ? link : `https://${link}`, '_blank', 'noopener,noreferrer');
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <ReadRow v-if="user" :label="t('user')" :value="user" icon="i-lucide-user" />
    <ReadRow v-if="password" :label="t('password')" :value="password" icon="i-lucide-key-round" secret />

    <div v-if="entry.otp" class="rounded-2xl bg-elevated/50 px-4 py-3">
      <OtpField :entry="entry" />
    </div>

    <ReadRow v-if="url" :label="t('website')" :value="url" icon="i-lucide-globe">
      <template #actions>
        <UButton color="neutral" variant="ghost" icon="i-lucide-external-link" :aria-label="t('detOpenWebsite')" @click="open(url)" />
      </template>
    </ReadRow>
    <ReadRow v-for="(u, i) in entry.extraUrls" :key="`u${i}`" :label="t('website')" :value="u" icon="i-lucide-globe">
      <template #actions>
        <UButton color="neutral" variant="ghost" icon="i-lucide-external-link" :aria-label="t('detOpenWebsite')" @click="open(u)" />
      </template>
    </ReadRow>

    <ReadRow
      v-for="f in entry.fields"
      :key="`f${f.name}`"
      :label="f.name"
      :value="resolve(f.value)"
      icon="i-lucide-text-cursor-input"
      :secret="f.protected"
    />

    <!-- Notes: long and may hold links, so a block with its own copy button -->
    <div v-if="entry.notes" class="rounded-2xl bg-elevated/50 px-4 py-3.5">
      <div class="flex items-center gap-2 mb-1">
        <span class="flex-1 text-sm text-muted first-letter:uppercase">{{ t('notes') }}</span>
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-copy"
          :aria-label="t('detCopyField', t('notes'))"
          @click="copy(entry.notes, t('notes'))"
        />
      </div>
      <!-- eslint-disable-next-line vue/no-v-html -- sanitized by renderMarkdown (DOMPurify) -->
      <div v-if="notesHtml" class="text-sm [&_a]:text-primary [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_h1]:font-semibold whitespace-pre-wrap" v-html="notesHtml" />
      <p v-else class="text-sm whitespace-pre-wrap break-words select-text">{{ entry.notes }}</p>
    </div>

    <div v-if="entry.tags.length" class="flex flex-wrap gap-1.5 px-1 pt-1">
      <UBadge v-for="tag in entry.tags" :key="tag" color="neutral" variant="soft" icon="i-lucide-tag" :label="tag" />
    </div>

    <div v-if="entry.attachments.length" class="px-1 pt-1">
      <AttachmentsList :file-id="entry.fileId" :entry-id="entry.id" :attachments="entry.attachments" />
    </div>

    <p v-if="entry.expires" class="flex items-center gap-2 px-1 pt-1 text-sm" :class="entry.expired ? 'text-error' : 'text-muted'">
      <UIcon name="i-lucide-calendar-clock" class="size-4" />
      {{ t('detExpires') }}: {{ dateFmt.format(new Date(entry.expires)) }}
    </p>
  </div>
</template>
