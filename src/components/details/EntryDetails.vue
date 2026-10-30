<script setup lang="ts">
import { ref, computed, watch, reactive, nextTick, useTemplateRef } from 'vue';
import type { DropdownMenuItem } from '@nuxt/ui';
import { t } from '@/i18n';
import { useVaultStore } from '@/stores/vault';
import { useUiStore } from '@/stores/ui';
import FieldRow from '@/components/details/FieldRow.vue';
import PasswordField from '@/components/details/PasswordField.vue';
import TagsField from '@/components/details/TagsField.vue';
import CustomFields from '@/components/details/CustomFields.vue';
import AttachmentsList from '@/components/details/AttachmentsList.vue';
import OtpField from '@/components/details/OtpField.vue';
import ExpiryField from '@/components/details/ExpiryField.vue';
import IconPicker from '@/components/details/IconPicker.vue';
import ColorPicker from '@/components/details/ColorPicker.vue';
import HistoryPanel from '@/components/details/HistoryPanel.vue';
import ExtraUrls from '@/components/details/ExtraUrls.vue';
import NotesField from '@/components/details/NotesField.vue';
import AutoTypePanel from '@/components/details/AutoTypePanel.vue';
import MoveEntryModal from '@/components/details/MoveEntryModal.vue';
import ConfirmModal from '@/components/shared/ConfirmModal.vue';
import { isDesktop } from '@/composables/useDesktop';
import { useMediaQuery } from '@vueuse/core';
import EntryIcon from '@/components/shared/EntryIcon.vue';
import EntryReadView from '@/components/details/read/EntryReadView.vue';

const vault = useVaultStore();
const ui = useUiStore();

const entry = computed(() => vault.selectedEntry);
const emptyLabel = computed(() =>
  vault.allEntries.length === 0 ? t('detCreateEntry') : t('detSelectEntry')
);

// File used for creating new entries / templates in the empty state.
const emptyFileId = computed(() => {
  if (vault.selection.type === 'group' || vault.selection.type === 'trash') {
    if (vault.selection.fileId) return vault.selection.fileId;
  }
  return vault.files[0]?.id;
});

const templates = computed(() =>
  emptyFileId.value ? vault.getEntryTemplates(emptyFileId.value) : []
);

const templateItems = computed<DropdownMenuItem[]>(() =>
  templates.value.map((tpl) => ({
    label: tpl.title,
    icon: 'i-lucide-file-text',
    onSelect: () => {
      if (emptyFileId.value) vault.createFromTemplate(emptyFileId.value, tpl.id);
    }
  }))
);

function newEntry(): void {
  vault.createEntry();
}

function restore(): void {
  const e = entry.value;
  if (e) vault.restoreEntry(e.fileId, e.id);
}

const desktopApp = isDesktop();

// Touchscreens open an entry to read and copy; the form is one tap away.
// A blank (new) entry opens straight in the form.
const touch = useMediaQuery('(pointer: coarse)');
const blank = (() => {
  const e = vault.selectedEntry;
  return !!e && !e.title && !e.username && !e.password && !e.url && !e.notes;
})();
const editing = ref(blank);
const readMode = computed(() => touch.value && !editing.value);

function doneEditing(): void {
  commitTitle();
  editing.value = false;
}

// ---- optional sections: shown when they have content, or once asked for ----
const shown = reactive({ otp: false, urls: false, tags: false, fields: false, expiry: false });
const otpField = useTemplateRef<{ setup: () => void }>('otpField');
const extraUrls = useTemplateRef<{ focus: () => void }>('extraUrls');
const tagsField = useTemplateRef<{ focus: () => void }>('tagsField');
const customFields = useTemplateRef<{ add: () => void }>('customFields');
const expiryField = useTemplateRef<{ focus: () => void }>('expiryField');
const attachInput = useTemplateRef<HTMLInputElement>('attachInput');

// The chosen section takes focus once the menu has finished closing (its
// close-focus hook), so typing right away lands in the new field.
let afterMenu: (() => void) | null = null;
function reveal(key: keyof typeof shown, then: () => void): void {
  shown[key] = true;
  afterMenu = then;
}
async function onAddMenuClosed(e: Event): Promise<void> {
  e.preventDefault();
  const run = afterMenu;
  afterMenu = null;
  await nextTick();
  run?.();
}

const addItems = computed<DropdownMenuItem[]>(() => {
  const e = entry.value;
  if (!e) return [];
  const items: DropdownMenuItem[] = [];
  if (!e.otp) items.push({ label: t('detOtpField'), icon: 'i-lucide-timer', onSelect: () => reveal('otp', () => otpField.value?.setup()) });
  items.push({ label: t('detAddWebsite'), icon: 'i-lucide-globe', onSelect: () => reveal('urls', () => extraUrls.value?.focus()) });
  items.push({ label: t('detAddTag'), icon: 'i-lucide-tag', onSelect: () => reveal('tags', () => tagsField.value?.focus()) });
  items.push({ label: t('detAddCustomField'), icon: 'i-lucide-text-cursor-input', onSelect: () => reveal('fields', () => customFields.value?.add()) });
  items.push({ label: t('detAddAttachmentItem'), icon: 'i-lucide-paperclip', onSelect: () => attachInput.value?.click() });
  if (!e.expires) items.push({ label: t('detAddExpiry'), icon: 'i-lucide-calendar-clock', onSelect: () => reveal('expiry', () => expiryField.value?.focus()) });
  return items;
});

async function onAttach(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const e = entry.value;
  if (!e || !input.files) return;
  for (const file of Array.from(input.files)) {
    await vault.addAttachment(e.fileId, e.id, file.name, await file.arrayBuffer());
  }
  input.value = '';
}

const moreItems = computed<DropdownMenuItem[]>(() => {
  const e = entry.value;
  if (!e) return [];
  return [
    ...(touch.value && e.inTrash ? [{ label: t('detRestore'), icon: 'i-lucide-archive-restore', onSelect: restore }] : []),
    { label: t('detClone'), icon: 'i-lucide-copy-plus', onSelect: clone },
    ...(!e.inTrash ? [{ label: t('detMoveToGroup'), icon: 'i-lucide-folder-input', onSelect: () => (moveOpen.value = true) }] : []),
    ...(e.historyLength ? [{ label: `${t('detHistoryItem')} (${e.historyLength})`, icon: 'i-lucide-history', onSelect: () => (showHistory.value = true) }] : [])
    ,
    ...(touch.value
      ? [{ label: deleteIsPermanent.value ? t('detDelEntryPerm') : t('detDelEntry'), icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: remove }]
      : [])
  ];
});

const title = ref('');
const showHistory = ref(false);

watch(
  entry,
  (e) => {
    title.value = e?.title ?? '';
  },
  { immediate: true }
);

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
function formatDate(ms: number): string {
  return dateFmt.format(new Date(ms));
}

function commitTitle(): void {
  const e = entry.value;
  if (e && title.value !== e.title) vault.updateField(e.fileId, e.id, 'Title', title.value);
}

function onField(name: string, value: string, protect = false): void {
  const e = entry.value;
  if (e) vault.updateField(e.fileId, e.id, name, value, protect);
}

function setIcon(icon: number): void {
  const e = entry.value;
  if (e) vault.setIcon(e.fileId, e.id, icon);
}

function setColor(color: string | undefined): void {
  const e = entry.value;
  if (e) vault.setColor(e.fileId, e.id, color);
}

function setTags(tags: string[]): void {
  const e = entry.value;
  if (e) vault.setTags(e.fileId, e.id, tags);
}

function openUrl(): void {
  const e = entry.value;
  if (e?.url) window.open(e.url, '_blank', 'noopener,noreferrer');
}

function clone(): void {
  const e = entry.value;
  if (e) vault.cloneEntry(e.fileId, e.id);
}

const moveOpen = ref(false);

const deleteConfirmOpen = ref(false);

// Without a recycle bin (already in it, or turned off for this database) a
// delete is permanent, so it gets a confirmation instead of an Undo.
const deleteIsPermanent = computed(() => {
  const e = entry.value;
  if (!e) return false;
  return e.inTrash || vault.findFile(e.fileId)?.recycleBinEnabled === false;
});

function remove(): void {
  if (!entry.value) return;
  if (deleteIsPermanent.value) deleteConfirmOpen.value = true;
  else trash();
}

function trash(): void {
  const e = entry.value;
  if (!e) return;
  const { fileId, id } = e;
  if (!vault.deleteEntry(fileId, id)) {
    ui.notify(t('detDeleted'), { color: 'info', description: e.title || t('noTitle') });
    return;
  }
  ui.notify(t('detMovedToTrash'), {
    color: 'info',
    description: e.title || t('noTitle'),
    action: {
      label: t('detUndo'),
      onClick: () => {
        vault.restoreEntry(fileId, id);
        vault.selectEntry(id);
      }
    }
  });
}

function confirmDelete(): void {
  const e = entry.value;
  if (e) vault.deleteEntry(e.fileId, e.id);
}
</script>

<template>
  <div v-if="!entry" class="flex h-full flex-col items-center justify-center gap-3 text-muted">
    <UIcon name="i-lucide-key" class="size-12 opacity-40" />
    <p class="text-sm">{{ emptyLabel }}</p>
    <div class="flex items-center gap-2">
      <UButton color="primary" icon="i-lucide-plus" @click="newEntry">
        {{ t('searchAddNew') }}
      </UButton>
      <UDropdownMenu v-if="templateItems.length" :items="templateItems">
        <UButton color="neutral" variant="soft" icon="i-lucide-file-text" trailing-icon="i-lucide-chevron-down">
          {{ t('template') }}
        </UButton>
      </UDropdownMenu>
    </div>
  </div>

  <div v-else class="flex flex-col gap-5 p-4 max-w-3xl">
    <!-- Header: back (phones), icon, title, then the few actions; the rest live in ⋯ -->
    <div
      class="flex items-center gap-1.5 max-md:sticky max-md:top-0 max-md:z-10 max-md:-mx-4 max-md:-mt-4 max-md:px-2 max-md:py-1.5 max-md:bg-default/90 max-md:backdrop-blur max-md:border-b max-md:border-default"
    >
      <UButton
        class="md:hidden"
        color="neutral"
        variant="ghost"
        icon="i-lucide-arrow-left"
        :aria-label="t('back')"
        data-testid="details-back"
        @click="vault.selectEntry(null)"
      />
      <template v-if="readMode">
        <EntryIcon :icon="entry.icon" :color="entry.color" size="1.5rem" class="mx-1.5" />
        <h1 class="flex-1 min-w-0 truncate text-lg font-semibold text-highlighted">{{ entry.title || t('noTitle') }}</h1>
        <UButton color="primary" variant="soft" icon="i-lucide-pencil" :label="t('edit')" data-testid="edit-entry" @click="editing = true" />
      </template>
      <IconPicker v-if="!readMode" :icon="entry.icon" :color="entry.color" @select="setIcon" />
      <UInput
        v-if="!readMode"
        v-model="title"
        variant="ghost"
        size="xl"
        :placeholder="t('noTitle')"
        class="flex-1 min-w-0 font-semibold"
        @blur="commitTitle"
        @keydown.enter="commitTitle"
      />
      <ColorPicker v-if="!readMode" :color="entry.color" @select="setColor" />
      <template v-if="!touch">
      <UTooltip v-if="entry.inTrash" :text="t('detRestore')">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-archive-restore"
          :aria-label="t('detRestore')"
          @click="restore"
        />
      </UTooltip>
      <UTooltip :text="deleteIsPermanent ? t('detDelEntryPerm') : t('detDelEntry')">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-trash-2"
          :aria-label="deleteIsPermanent ? t('detDelEntryPerm') : t('detDelEntry')"
          @click="remove"
        />
      </UTooltip>
      </template>
      <UButton
        v-if="touch && editing"
        color="primary"
        icon="i-lucide-check"
        :label="t('detDone')"
        data-testid="done-editing"
        @click="doneEditing"
      />
      <UDropdownMenu :items="moreItems" :content="{ align: 'end' }">
        <UButton color="neutral" variant="ghost" icon="i-lucide-ellipsis-vertical" :aria-label="t('options')" />
      </UDropdownMenu>
    </div>

    <EntryReadView v-if="readMode" :entry="entry" />

    <template v-else>
    <FieldRow
      :label="t('user')"
      :model-value="entry.username"
      :file-id="entry.fileId"
      icon="i-lucide-user"
      @commit="(v) => onField('UserName', v)"
    />

    <PasswordField
      :model-value="entry.password"
      :file-id="entry.fileId"
      :user-inputs="[entry.title, entry.username]"
      @commit="(v) => onField('Password', v)"
    />

    <OtpField v-if="entry.otp || shown.otp" ref="otpField" :entry="entry" />

    <FieldRow
      :label="t('website')"
      :model-value="entry.url"
      :file-id="entry.fileId"
      icon="i-lucide-globe"
      @commit="(v) => onField('URL', v)"
    >
      <template #actions>
        <UTooltip :text="t('detOpenWebsite')">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-external-link"
            :aria-label="t('detOpenWebsite')"
            :disabled="!entry.url"
            @click="openUrl"
          />
        </UTooltip>
      </template>
    </FieldRow>

    <ExtraUrls
      v-if="entry.extraUrls.length || shown.urls"
      ref="extraUrls"
      :file-id="entry.fileId"
      :entry-id="entry.id"
      :urls="entry.extraUrls"
    />

    <NotesField :model-value="entry.notes" @commit="(v) => onField('Notes', v)" />

    <TagsField v-if="entry.tags.length || shown.tags" ref="tagsField" :tags="entry.tags" @update="setTags" />

    <CustomFields
      v-show="entry.fields.length || shown.fields"
      ref="customFields"
      :file-id="entry.fileId"
      :entry-id="entry.id"
      :fields="entry.fields"
    />

    <AttachmentsList
      v-if="entry.attachments.length"
      :file-id="entry.fileId"
      :entry-id="entry.id"
      :attachments="entry.attachments"
    />

    <ExpiryField
      v-if="entry.expires || shown.expiry"
      ref="expiryField"
      :file-id="entry.fileId"
      :entry-id="entry.id"
      :expires="entry.expires"
      :expired="entry.expired"
    />

    <!-- Everything optional is one menu away instead of always on screen -->
    <div v-if="addItems.length && !entry.inTrash">
      <UDropdownMenu
        :items="addItems"
        :content="{ align: 'start', onCloseAutoFocus: onAddMenuClosed }"
      >
        <UButton color="neutral" variant="soft" size="sm" icon="i-lucide-plus" trailing-icon="i-lucide-chevron-down" data-testid="add-to-entry">
          {{ t('detAddToEntry') }}
        </UButton>
      </UDropdownMenu>
      <input ref="attachInput" type="file" multiple class="hidden" @change="onAttach" />
    </div>

    </template>

    <USeparator />

    <AutoTypePanel v-if="desktopApp" :entry="entry" />

    <!-- Metadata footer -->
    <div class="flex flex-col gap-1 text-xs text-muted">
      <div v-if="entry.groupPath.length" class="flex items-center gap-1">
        <UIcon name="i-lucide-folder" />
        <span>{{ entry.groupPath.join(' / ') }}</span>
      </div>
      <div>{{ t('detCreated') }}: {{ formatDate(entry.created) }}</div>
      <div>{{ t('detUpdated') }}: {{ formatDate(entry.updated) }}</div>
    </div>

    <MoveEntryModal
      v-model:open="moveOpen"
      :file-id="entry.fileId"
      :entry-id="entry.id"
      :current-group-id="entry.groupId"
    />

    <HistoryPanel
      v-model:open="showHistory"
      :file-id="entry.fileId"
      :entry-id="entry.id"
      :length="entry.historyLength"
    />

    <!-- Confirm permanent deletion (entry already in trash, or no recycle bin) -->
    <ConfirmModal
      v-model:open="deleteConfirmOpen"
      :title="entry.inTrash ? t('detDelFromTrash') : t('detDelNoTrash')"
      :description="t('detDelFromTrashBody')"
      :confirm-label="t('detDelEntryPerm')"
      @confirm="confirmDelete"
    />
  </div>
</template>
