<script setup lang="ts">
/**
 * "Move to group…" dialog: shows the group tree of the entry's file
 * (recycle bin and the entry's current group excluded) and moves the entry
 * on selection.
 */
import { computed } from 'vue';
import { t } from '@/i18n';
import { useVaultStore } from '@/stores/vault';
import type { GroupVm } from '@/types';
import EntryIcon from '@/components/shared/EntryIcon.vue';

const props = defineProps<{ fileId: string; entryId: string; currentGroupId: string }>();

const open = defineModel<boolean>('open', { default: false });

const vault = useVaultStore();

interface FlatGroup {
  group: GroupVm;
  depth: number;
  disabled: boolean;
}

/** Group tree of the entry's file, flattened for indented rendering. */
const flatGroups = computed<FlatGroup[]>(() => {
  const tree = vault.groupTrees.find((ft) => ft.file.id === props.fileId)?.tree;
  if (!tree) return [];
  const out: FlatGroup[] = [];
  const walk = (g: GroupVm, depth: number): void => {
    if (g.isRecycleBin) return;
    out.push({ group: g, depth, disabled: g.id === props.currentGroupId });
    for (const child of g.children) walk(child, depth + 1);
  };
  walk(tree, 0);
  return out;
});

function moveTo(groupId: string): void {
  vault.moveEntry(props.fileId, props.entryId, groupId);
  open.value = false;
}
</script>

<template>
  <UModal v-model:open="open" :title="t('detMoveToGroup')">
    <template #body>
      <div class="flex flex-col gap-1">
        <p class="text-sm text-muted mb-1">{{ t('moveEntryChooseGroup') }}</p>
        <button
          v-for="fg in flatGroups"
          :key="fg.group.id"
          type="button"
          class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          :class="
            fg.disabled
              ? 'opacity-50 cursor-not-allowed text-muted'
              : 'cursor-pointer text-default hover:bg-elevated'
          "
          :style="{ paddingLeft: `${0.5 + fg.depth * 1}rem` }"
          :disabled="fg.disabled"
          @click="moveTo(fg.group.id)"
        >
          <EntryIcon :icon="fg.group.icon" size="0.95rem" />
          <span class="flex-1 truncate">{{ fg.group.name }}</span>
          <UBadge
            v-if="fg.group.entryCount"
            :label="String(fg.group.entryCount)"
            color="neutral"
            variant="soft"
            size="sm"
          />
        </button>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end w-full">
        <UButton color="neutral" variant="ghost" :label="t('alertCancel')" @click="open = false" />
      </div>
    </template>
  </UModal>
</template>
