<script setup lang="ts">
import { ref, computed } from 'vue';
import { t } from '@/i18n';
import { useVaultStore } from '@/stores/vault';

const props = defineProps<{ tags: string[] }>();
const emit = defineEmits<{ update: [tags: string[]] }>();

const vault = useVaultStore();
const draft = ref('');

const suggestions = computed(() => {
  const q = draft.value.trim().toLowerCase();
  return vault.tags
    .filter((tag) => !props.tags.includes(tag))
    .filter((tag) => !q || tag.toLowerCase().includes(q))
    .slice(0, 8);
});

function addTag(name: string): void {
  const value = name.trim();
  if (!value || props.tags.includes(value)) {
    draft.value = '';
    return;
  }
  emit('update', [...props.tags, value]);
  draft.value = '';
}

function removeTag(tag: string): void {
  emit(
    'update',
    props.tags.filter((x) => x !== tag)
  );
}
</script>

<template>
  <UFormField :label="t('tags')">
    <div class="flex flex-wrap items-center gap-1.5">
      <UBadge
        v-for="tag in props.tags"
        :key="tag"
        color="neutral"
        variant="soft"
        class="gap-1"
      >
        {{ tag }}
        <UButton
          color="neutral"
          variant="link"
          size="xs"
          icon="i-lucide-x"
          class="p-0"
          :aria-label="`${t('remove')} ${tag}`"
          @click="removeTag(tag)"
        />
      </UBadge>

      <UInput
        v-model="draft"
        :placeholder="t('tags')"
        size="sm"
        autocomplete="off"
        class="w-40"
        @keydown.enter.prevent="addTag(draft)"
      />
    </div>

    <div v-if="suggestions.length" class="mt-1.5 flex flex-wrap gap-1">
      <UButton
        v-for="s in suggestions"
        :key="s"
        color="neutral"
        variant="outline"
        size="xs"
        @click="addTag(s)"
      >
        {{ s }}
      </UButton>
    </div>
  </UFormField>
</template>
