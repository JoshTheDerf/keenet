<script setup lang="ts">
import { computed, ref } from 'vue';
import { t } from '@/i18n';
import { useVaultStore } from '@/stores/vault';
import type { AuditIssue, IssueKind } from '@/domain/audit';
import type { EntryVm } from '@/types';
import EntryIcon from '@/components/shared/EntryIcon.vue';

const open = defineModel<boolean>('open', { required: true });

const vault = useVaultStore();
const checking = ref(false);

type BadgeColor = 'error' | 'warning' | 'neutral';

const KIND_ORDER: IssueKind[] = ['weak', 'pwned', 'duplicate', 'old'];
const KIND_LABEL_KEY: Record<IssueKind, string> = {
  weak: 'auditKindWeak',
  pwned: 'auditKindPwned',
  duplicate: 'auditKindReused',
  old: 'auditKindOld'
};
const KIND_COLOR: Record<IssueKind, BadgeColor> = {
  weak: 'error',
  pwned: 'error',
  duplicate: 'warning',
  old: 'neutral'
};

/**
 * The domain layer emits English detail strings; re-derive a localized detail
 * from the issue kind plus the number embedded in the detail.
 */
function localizedDetail(issue: AuditIssue): string {
  const num = issue.detail.match(/[\d.]+/)?.[0];
  if (num === undefined) return issue.detail;
  switch (issue.kind) {
    case 'weak':
      return t('auditDetailLowEntropy', num);
    case 'old':
      return t('auditDetailOld', num);
    case 'duplicate':
      return t('auditDetailReused', num);
    case 'pwned':
      return t('auditDetailPwned', num);
    default:
      return issue.detail;
  }
}

/** Fast entry lookup by id. */
const entriesById = computed(() => {
  const map = new Map<string, EntryVm>();
  for (const entry of vault.allEntries) map.set(entry.id, entry);
  return map;
});

/** Pwned findings synthesized from the HIBP result map. */
const pwnedIssues = computed<AuditIssue[]>(() => {
  const out: AuditIssue[] = [];
  for (const [entryId, count] of vault.pwnedResults) {
    const entry = entriesById.value.get(entryId);
    if (!entry) continue;
    out.push({
      entryId,
      fileId: entry.fileId,
      kind: 'pwned',
      detail: t('auditDetailPwned', count)
    });
  }
  return out;
});

const allIssues = computed<AuditIssue[]>(() => [...vault.auditIssues, ...pwnedIssues.value]);

/** Issues grouped by kind, in display order; empty groups dropped. */
const groups = computed(() =>
  KIND_ORDER.map((kind) => ({
    kind,
    label: t(KIND_LABEL_KEY[kind]),
    color: KIND_COLOR[kind],
    issues: allIssues.value.filter((issue) => issue.kind === kind)
  })).filter((group) => group.issues.length > 0)
);

const summary = computed(() =>
  KIND_ORDER.map((kind) => ({
    kind,
    label: t(KIND_LABEL_KEY[kind]),
    color: KIND_COLOR[kind],
    count: allIssues.value.filter((issue) => issue.kind === kind).length
  })).filter((item) => item.count > 0)
);

const hasIssues = computed(() => allIssues.value.length > 0);

function entryFor(id: string): EntryVm | undefined {
  return entriesById.value.get(id);
}

async function runCheck(): Promise<void> {
  checking.value = true;
  try {
    await vault.checkPwned();
  } finally {
    checking.value = false;
  }
}

function openEntry(id: string): void {
  vault.selectEntry(id);
  open.value = false;
}
</script>

<template>
  <UModal v-model:open="open" :title="t('cmdPasswordAudit')" :ui="{ content: 'max-w-xl' }">
    <template #body>
      <div class="flex flex-col gap-4">
        <!-- Summary -->
        <div v-if="summary.length" class="flex flex-wrap gap-2">
          <UBadge
            v-for="item in summary"
            :key="item.kind"
            :color="item.color"
            variant="subtle"
          >
            {{ item.count }} {{ item.label }}
          </UBadge>
        </div>

        <!-- HIBP check -->
        <div class="flex flex-col gap-2">
          <UButton
            color="primary"
            variant="soft"
            icon="i-lucide-shield-alert"
            :loading="checking"
            :disabled="checking"
            class="self-start"
            @click="runCheck"
          >
            {{ t('auditCheckHibp') }}
          </UButton>
          <p class="text-xs text-muted">
            {{ t('auditHibpPrivacy') }}
          </p>
        </div>

        <USeparator />

        <!-- Empty state -->
        <p v-if="!hasIssues" class="py-6 text-center text-sm text-muted">
          {{ t('auditNoIssues') }}
        </p>

        <!-- Grouped issues -->
        <div v-else class="flex flex-col gap-4">
          <section v-for="group in groups" :key="group.kind" class="flex flex-col gap-1.5">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">
              {{ group.label }} ({{ group.issues.length }})
            </h3>
            <template v-for="(issue, idx) in group.issues" :key="`${issue.kind}-${issue.entryId}-${idx}`">
              <button
                v-if="entryFor(issue.entryId)"
                type="button"
                class="flex w-full items-center gap-2.5 rounded-md border border-default px-2.5 py-2 text-left transition-colors hover:bg-elevated"
                @click="openEntry(issue.entryId)"
              >
                <EntryIcon
                  :icon="entryFor(issue.entryId)!.icon"
                  :color="entryFor(issue.entryId)!.color"
                  size="1.1rem"
                />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium">
                    {{ entryFor(issue.entryId)!.title || `(${t('noTitle')})` }}
                  </span>
                  <span class="block truncate text-xs text-muted">{{ localizedDetail(issue) }}</span>
                </span>
                <UBadge :color="group.color" variant="subtle" size="sm">
                  {{ group.label }}
                </UBadge>
              </button>
            </template>
          </section>
        </div>
      </div>
    </template>
  </UModal>
</template>
