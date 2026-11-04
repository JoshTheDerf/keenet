<script setup lang="ts">
import { ref, computed } from 'vue';
import type { DropdownMenuItem } from '@nuxt/ui';
import { t } from '@/i18n';
import type { GroupVm } from '@/types';
import { useVaultStore } from '@/stores/vault';
import EntryIcon from '@/components/shared/EntryIcon.vue';
import TextPromptModal from '@/components/shared/TextPromptModal.vue';
import ConfirmModal from '@/components/shared/ConfirmModal.vue';
// Recursive self-reference: an SFC may import itself.
import MenuGroupNode from '@/components/menu/MenuGroupNode.vue';

const props = defineProps<{ group: GroupVm; fileId: string; depth?: number }>();

const vault = useVaultStore();

const depth = computed(() => props.depth ?? 0);

// Recycle bin is rendered under the Trash section, not in the tree.
const childGroups = computed(() => props.group.children.filter((c) => !c.isRecycleBin));

const expanded = ref(props.group.expanded);

const isActive = computed(() => {
  const sel = vault.selection;
  return sel.type === 'group' && sel.fileId === props.fileId && sel.groupId === props.group.id;
});

function select(): void {
  vault.setSelection({ type: 'group', fileId: props.fileId, groupId: props.group.id });
}

function toggle(e: Event): void {
  e.stopPropagation();
  expanded.value = !expanded.value;
}

/** Keyboard support for the row itself (ignore keys bubbling from inner buttons). */
function onRowKeydown(e: KeyboardEvent): void {
  if (e.target !== e.currentTarget) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    select();
  } else if (e.key === 'ArrowRight' && childGroups.value.length) {
    e.preventDefault();
    expanded.value = true;
  } else if (e.key === 'ArrowLeft' && childGroups.value.length) {
    e.preventDefault();
    expanded.value = false;
  }
}

function addSubgroup(): void {
  vault.createGroup(props.fileId, props.group.id, t('menuNewGroupName'));
  expanded.value = true;
}

const renameOpen = ref(false);

function rename(): void {
  renameOpen.value = true;
}

function confirmRename(name: string): void {
  if (name !== props.group.name) {
    vault.renameGroup(props.fileId, props.group.id, name);
  }
}

const deleteOpen = ref(false);

function confirmDelete(): void {
  vault.deleteGroup(props.fileId, props.group.id);
}

const menuItems = computed<DropdownMenuItem[]>(() => [
  { label: t('grpRename'), icon: 'i-lucide-pencil', onSelect: () => rename() },
  { label: t('menuNewSubgroup'), icon: 'i-lucide-folder-plus', onSelect: () => addSubgroup() },
  {
    label: t('detDelEntry'),
    icon: 'i-lucide-trash',
    color: 'error',
    disabled: props.group.isRoot,
    onSelect: () => {
      deleteOpen.value = true;
    }
  }
]);
</script>

<template>
  <div>
    <div
      class="group nav-pill gap-2 pr-1"
      :class="{ 'is-active': isActive }"
      :style="{ paddingLeft: `${0.25 + depth * 1}rem` }"
      role="treeitem"
      tabindex="0"
      :aria-selected="isActive"
      :aria-expanded="childGroups.length ? expanded : undefined"
      :aria-level="depth + 1"
      @click="select"
      @dblclick="rename"
      @keydown="onRowKeydown"
    >
      <button
        type="button"
        class="shrink-0 flex items-center justify-center size-6 max-md:size-8 rounded-full hover:bg-accented/50"
        :class="{ invisible: !childGroups.length }"
        :aria-label="t('menuToggleGroup')"
        @click="toggle"
      >
        <UIcon
          :name="expanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
          class="size-3.5"
        />
      </button>

      <EntryIcon :icon="group.icon" size="1.1rem" />
      <span class="flex-1 truncate">{{ group.name }}</span>

      <span v-if="group.totalEntryCount" class="text-xs text-muted tabular-nums">{{ group.totalEntryCount }}</span>

      <UTooltip :text="t('menuNewSubgroup')">
        <UButton
          icon="i-lucide-plus"
          color="neutral"
          variant="ghost"
          size="xs"
          class="hidden pointer-fine:inline-flex pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 focus-visible:opacity-100"
          :aria-label="t('menuNewSubgroup')"
          @click.stop="addSubgroup"
        />
      </UTooltip>

      <UDropdownMenu :items="menuItems" :content="{ align: 'start' }">
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

    <div v-if="expanded && childGroups.length" role="group">
      <MenuGroupNode
        v-for="child in childGroups"
        :key="child.id"
        :group="child"
        :file-id="fileId"
        :depth="depth + 1"
      />
    </div>

    <!-- Rename group -->
    <TextPromptModal
      v-model:open="renameOpen"
      :title="t('grpRename')"
      :placeholder="t('name')"
      :initial="group.name"
      :confirm-label="t('tagRename')"
      @confirm="confirmRename"
    />

    <!-- Confirm deleting the group (removes contained entries too) -->
    <ConfirmModal
      v-model:open="deleteOpen"
      :title="t('grpTrash')"
      :description="t('grpDeleteAlertBody', group.name)"
      :confirm-label="t('detDelEntry')"
      @confirm="confirmDelete"
    />
  </div>
</template>
