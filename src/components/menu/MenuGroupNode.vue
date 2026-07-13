<script setup lang="ts">
import { ref, computed } from 'vue';
import type { DropdownMenuItem } from '@nuxt/ui';
import { t } from '@/i18n';
import type { GroupVm } from '@/types';
import { useVaultStore } from '@/stores/vault';
import EntryIcon from '@/components/shared/EntryIcon.vue';
import TextPromptModal from '@/components/shared/TextPromptModal.vue';
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
  deleteOpen.value = false;
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
      class="group flex items-center gap-1.5 pr-1 py-1 max-md:min-h-11 max-md:text-base rounded-md cursor-pointer text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      :class="
        isActive ? 'bg-primary/10 text-primary' : 'text-muted hover:text-default hover:bg-elevated'
      "
      :style="{ paddingLeft: `${0.25 + depth * 0.75}rem` }"
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
        class="shrink-0 flex items-center justify-center size-4 rounded hover:bg-accented/50"
        :class="{ invisible: !childGroups.length }"
        :aria-label="t('menuToggleGroup')"
        @click="toggle"
      >
        <UIcon
          :name="expanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
          class="size-3.5"
        />
      </button>

      <EntryIcon :icon="group.icon" size="0.95rem" />
      <span class="flex-1 truncate">{{ group.name }}</span>

      <UBadge
        v-if="group.totalEntryCount"
        :label="String(group.totalEntryCount)"
        color="neutral"
        variant="soft"
        size="sm"
      />

      <UTooltip :text="t('menuNewSubgroup')">
        <UButton
          icon="i-lucide-plus"
          color="neutral"
          variant="ghost"
          size="xs"
          class="opacity-0 group-hover:opacity-100"
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
          class="opacity-0 group-hover:opacity-100"
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
    <UModal v-model:open="deleteOpen" :title="t('grpTrash')">
      <template #body>
        <p class="text-sm text-muted">{{ t('grpDeleteAlertBody', group.name) }}</p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            color="neutral"
            variant="ghost"
            :label="t('alertCancel')"
            @click="deleteOpen = false"
          />
          <UButton color="error" :label="t('detDelEntry')" @click="confirmDelete" />
        </div>
      </template>
    </UModal>
  </div>
</template>
