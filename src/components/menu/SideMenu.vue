<script setup lang="ts">
import { computed, ref } from 'vue';
import type { DropdownMenuItem } from '@nuxt/ui';
import { t } from '@/i18n';
import { useVaultStore } from '@/stores/vault';
import { ALL_COLORS } from '@/const/colors';
import ColorDot from '@/components/shared/ColorDot.vue';
import { colorLabel } from '@/components/shared/format';
import MenuGroupNode from '@/components/menu/MenuGroupNode.vue';
import ConfirmModal from '@/components/shared/ConfirmModal.vue';
import TextPromptModal from '@/components/shared/TextPromptModal.vue';

const vault = useVaultStore();

const allCount = computed(() => vault.allEntries.filter((e) => !e.inTrash).length);

const expiredCount = computed(
  () => vault.allEntries.filter((e) => e.expired && !e.inTrash).length
);
const hasExpired = computed(() => expiredCount.value > 0);

const isAllActive = computed(() => vault.selection.type === 'all');
const isExpiredActive = computed(() => vault.selection.type === 'expired');
const isTrashActive = computed(() => vault.selection.type === 'trash');

function isTagActive(tag: string): boolean {
  return vault.selection.type === 'tag' && vault.selection.tag === tag;
}

// ---- tag management ------------------------------------------------------

const renameOpen = ref(false);
const deleteOpen = ref(false);
const activeTag = ref('');

function tagMenuItems(tag: string): DropdownMenuItem[] {
  return [
    { label: t('tagRename'), icon: 'i-lucide-pencil', onSelect: () => openRename(tag) },
    { label: t('detDelEntry'), icon: 'i-lucide-trash', color: 'error', onSelect: () => openDelete(tag) }
  ];
}

function openRename(tag: string): void {
  activeTag.value = tag;
  renameOpen.value = true;
}

function confirmRename(to: string): void {
  const from = activeTag.value;
  if (to !== from) {
    // Tags aren't file-scoped in the UI, so apply across every open file.
    for (const f of vault.files) vault.renameTag(f.id, from, to);
    if (vault.selection.type === 'tag' && vault.selection.tag === from) {
      vault.setSelection({ type: 'all' });
    }
  }
}

function openDelete(tag: string): void {
  activeTag.value = tag;
  deleteOpen.value = true;
}

function confirmDelete(): void {
  const tag = activeTag.value;
  for (const f of vault.files) vault.deleteTag(f.id, tag);
  if (vault.selection.type === 'tag' && vault.selection.tag === tag) {
    vault.setSelection({ type: 'all' });
  }
}

function isColorActive(color: string): boolean {
  return vault.selection.type === 'color' && vault.selection.color === color;
}

// ---- empty trash (permanent) ---------------------------------------------

const emptyTrashOpen = ref(false);
const emptyTrashFileId = ref('');
const emptyTrashFileName = computed(
  () => vault.files.find((f) => f.id === emptyTrashFileId.value)?.name ?? ''
);

function openEmptyTrash(fileId: string): void {
  emptyTrashFileId.value = fileId;
  emptyTrashOpen.value = true;
}

function confirmEmptyTrash(): void {
  if (emptyTrashFileId.value) vault.emptyTrash(emptyTrashFileId.value);
}

// One file: a plain "Empty trash"; several: one item per file, named.
const trashItems = computed<DropdownMenuItem[]>(() =>
  vault.files.map((f) => ({
    label: vault.files.length > 1 ? t('menuEmptyTrashOf', f.name) : t('menuEmptyTrash'),
    icon: 'i-lucide-trash-2',
    color: 'error' as const,
    onSelect: () => openEmptyTrash(f.id)
  }))
);

const rowBase =
  'flex items-center gap-2 px-2 py-1.5 max-md:min-h-11 max-md:text-base rounded-md cursor-pointer text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';
const rowInactive = 'text-muted hover:text-default hover:bg-elevated';
const rowActive = 'bg-primary/10 text-primary';

/** Enter/Space activates a row (ignoring keys bubbling from inner buttons). */
function rowKeyActivate(e: KeyboardEvent, fn: () => void): void {
  if (e.target !== e.currentTarget) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fn();
  }
}
</script>

<template>
  <nav class="flex flex-col gap-4 p-2">
    <!-- All entries -->
    <div class="flex flex-col gap-0.5">
      <div
        :class="[rowBase, isAllActive ? rowActive : rowInactive]"
        role="button"
        tabindex="0"
        :aria-current="isAllActive ? 'true' : undefined"
        @click="vault.setSelection({ type: 'all' })"
        @keydown="rowKeyActivate($event, () => vault.setSelection({ type: 'all' }))"
      >
        <UIcon name="i-lucide-layout-grid" class="size-4 shrink-0" />
        <span class="flex-1 truncate">{{ t('menuAllItems') }}</span>
        <UBadge v-if="allCount" :label="String(allCount)" color="neutral" variant="soft" size="sm" />
      </div>

      <!-- Expired -->
      <div
        v-if="hasExpired"
        :class="[rowBase, isExpiredActive ? rowActive : rowInactive]"
        role="button"
        tabindex="0"
        :aria-current="isExpiredActive ? 'true' : undefined"
        @click="vault.setSelection({ type: 'expired' })"
        @keydown="rowKeyActivate($event, () => vault.setSelection({ type: 'expired' }))"
      >
        <UIcon name="i-lucide-triangle-alert" class="size-4 shrink-0 text-warning" />
        <span class="flex-1 truncate">{{ t('menuExpired') }}</span>
        <UBadge :label="String(expiredCount)" color="warning" variant="soft" size="sm" />
      </div>
    </div>

    <!-- Groups trees -->
    <div v-for="ft in vault.groupTrees" :key="ft.file.id" class="flex flex-col gap-0.5">
      <div class="flex items-center gap-1.5 px-2 pt-1 pb-0.5">
        <span class="text-xs font-semibold uppercase tracking-wide text-dimmed truncate">
          {{ ft.file.name }}
        </span>
      </div>
      <div role="tree" :aria-label="ft.file.name">
        <MenuGroupNode :group="ft.tree" :file-id="ft.file.id" :depth="0" />
      </div>
    </div>

    <!-- Tags -->
    <div v-if="vault.tags.length" class="flex flex-col gap-0.5">
      <div class="px-2 pb-0.5 text-xs font-semibold uppercase tracking-wide text-dimmed">
        {{ t('tags') }}
      </div>
      <div
        v-for="tag in vault.tags"
        :key="tag"
        :class="[rowBase, 'group', isTagActive(tag) ? rowActive : rowInactive]"
        role="button"
        tabindex="0"
        :aria-current="isTagActive(tag) ? 'true' : undefined"
        @click="vault.setSelection({ type: 'tag', tag })"
        @keydown="rowKeyActivate($event, () => vault.setSelection({ type: 'tag', tag }))"
      >
        <UIcon name="i-lucide-tag" class="size-4 shrink-0" />
        <span class="flex-1 truncate">{{ tag }}</span>
        <UDropdownMenu :items="tagMenuItems(tag)" :content="{ align: 'start' }">
          <UButton
            icon="i-lucide-ellipsis"
            color="neutral"
            variant="ghost"
            size="xs"
            class="pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 focus-visible:opacity-100"
            :aria-label="t('options')"
            @click.stop
          />
        </UDropdownMenu>
      </div>
    </div>

    <!-- Colors -->
    <div class="flex flex-col gap-1">
      <div class="px-2 text-xs font-semibold uppercase tracking-wide text-dimmed">
        {{ t('menuColors') }}
      </div>
      <div class="flex items-center gap-1.5 px-2 py-1">
        <button
          v-for="color in ALL_COLORS"
          :key="color"
          type="button"
          class="flex items-center justify-center rounded-full p-0.5 transition-shadow"
          :class="isColorActive(color) ? 'ring-2 ring-primary' : 'hover:ring-1 hover:ring-accented'"
          :aria-label="colorLabel(color)"
          @click="vault.setSelection({ type: 'color', color })"
        >
          <ColorDot :color="color" size="0.9rem" />
        </button>
      </div>
    </div>

    <!-- Trash -->
    <div class="flex items-center gap-1">
      <div
        :class="[rowBase, 'flex-1', isTrashActive ? rowActive : rowInactive]"
        role="button"
        tabindex="0"
        :aria-current="isTrashActive ? 'true' : undefined"
        @click="vault.setSelection({ type: 'trash' })"
        @keydown="rowKeyActivate($event, () => vault.setSelection({ type: 'trash' }))"
      >
        <UIcon name="i-lucide-trash" class="size-4 shrink-0" />
        <span class="flex-1 truncate">{{ t('menuTrash') }}</span>
      </div>
      <UDropdownMenu
        v-if="trashItems.length"
        :items="trashItems"
        :content="{ align: 'start' }"
      >
        <UButton
          icon="i-lucide-ellipsis"
          color="neutral"
          variant="ghost"
          size="xs"
          :aria-label="t('options')"
        />
      </UDropdownMenu>
    </div>

    <!-- Empty trash (permanent) -->
    <ConfirmModal
      v-model:open="emptyTrashOpen"
      :title="t('menuEmptyTrashAlert')"
      :description="t('menuEmptyTrashConfirm', emptyTrashFileName)"
      :confirm-label="t('menuEmptyTrash')"
      @confirm="confirmEmptyTrash"
    />

    <!-- Rename tag -->
    <TextPromptModal
      v-model:open="renameOpen"
      :title="t('menuRenameTag')"
      :placeholder="t('tagTitle')"
      :initial="activeTag"
      :confirm-label="t('tagRename')"
      @confirm="confirmRename"
    />

    <!-- Delete tag -->
    <ConfirmModal
      v-model:open="deleteOpen"
      :title="t('tagTrashQuestion')"
      :description="t('tagRemoveConfirm', activeTag)"
      :confirm-label="t('remove')"
      @confirm="confirmDelete"
    />
  </nav>
</template>
