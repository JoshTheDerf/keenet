<script setup lang="ts">
import { ref, computed, watch } from 'vue';
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
    <!-- Header: icon + title on one line; the actions wrap below on narrow screens -->
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
      <div class="flex flex-1 basis-64 items-center gap-2 min-w-0">
        <IconPicker :icon="entry.icon" :color="entry.color" @select="setIcon" />
        <UInput
          v-model="title"
          variant="ghost"
          size="xl"
          :placeholder="t('noTitle')"
          class="flex-1 min-w-0 font-semibold"
          @blur="commitTitle"
          @keydown.enter="commitTitle"
        />
      </div>
      <div class="flex items-center gap-1 ml-auto">
        <ColorPicker :color="entry.color" @select="setColor" />

        <UTooltip v-if="entry.inTrash" :text="t('detRestore')">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-archive-restore"
            :aria-label="t('detRestore')"
            @click="restore"
          />
        </UTooltip>

        <UTooltip :text="t('detClone')">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-copy-plus"
            :aria-label="t('detClone')"
            @click="clone"
          />
        </UTooltip>
        <UTooltip v-if="!entry.inTrash" :text="t('detMoveToGroup')">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-folder-input"
            :aria-label="t('detMoveToGroup')"
            @click="moveOpen = true"
          />
        </UTooltip>
        <UTooltip :text="deleteIsPermanent ? t('detDelEntryPerm') : t('detDelEntry')">
          <UButton
            color="error"
            variant="ghost"
            icon="i-lucide-trash-2"
            :aria-label="deleteIsPermanent ? t('detDelEntryPerm') : t('detDelEntry')"
            @click="remove"
          />
        </UTooltip>
      </div>
    </div>

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
      @commit="(v) => onField('Password', v, true)"
    />

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

    <ExtraUrls :file-id="entry.fileId" :entry-id="entry.id" :urls="entry.extraUrls" />

    <NotesField :model-value="entry.notes" @commit="(v) => onField('Notes', v)" />

    <TagsField :tags="entry.tags" @update="setTags" />

    <OtpField :file-id="entry.fileId" :entry-id="entry.id" :otp="entry.otp" />

    <CustomFields :file-id="entry.fileId" :entry-id="entry.id" :fields="entry.fields" />

    <AttachmentsList
      :file-id="entry.fileId"
      :entry-id="entry.id"
      :attachments="entry.attachments"
    />

    <ExpiryField
      :file-id="entry.fileId"
      :entry-id="entry.id"
      :expires="entry.expires"
      :expired="entry.expired"
    />

    <USeparator />

    <AutoTypePanel :entry="entry" />

    <!-- Metadata footer -->
    <div class="flex flex-col gap-1 text-xs text-muted">
      <div v-if="entry.groupPath.length" class="flex items-center gap-1">
        <UIcon name="i-lucide-folder" />
        <span>{{ entry.groupPath.join(' / ') }}</span>
      </div>
      <div>{{ t('detCreated') }}: {{ formatDate(entry.created) }}</div>
      <div>{{ t('detUpdated') }}: {{ formatDate(entry.updated) }}</div>
      <div v-if="entry.historyLength > 0" class="mt-1">
        <UButton
          color="neutral"
          variant="soft"
          size="xs"
          icon="i-lucide-history"
          @click="showHistory = true"
        >
          {{ t('history') }} ({{ entry.historyLength }})
        </UButton>
      </div>
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
