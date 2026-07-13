<script setup lang="ts">
import { ref, watch } from 'vue';
import { t } from '@/i18n';
import { webdavProvider } from '@/storage/webdav';
import { useSettingsStore } from '@/stores/settings';

const open = defineModel<boolean>('open', { default: false });

const emit = defineEmits<{
  loaded: [payload: { name: string; data: ArrayBuffer; url: string; user: string; password: string }];
}>();

const settings = useSettingsStore();

const url = ref('');
const user = ref('');
const password = ref('');
const loading = ref(false);
const error = ref<string | null>(null);

watch(open, (isOpen) => {
  if (isOpen) {
    url.value = settings.webdav.url;
    user.value = settings.webdav.user;
    password.value = settings.webdav.password;
    error.value = null;
    loading.value = false;
  }
});

function fileNameFromUrl(u: string): string {
  try {
    const path = new URL(u).pathname;
    const base = decodeURIComponent(path.split('/').filter(Boolean).pop() ?? '');
    return base || 'database.kdbx';
  } catch {
    const base = u.split('/').filter(Boolean).pop() ?? '';
    return base || 'database.kdbx';
  }
}

async function load(): Promise<void> {
  if (!url.value.trim() || loading.value) return;
  loading.value = true;
  error.value = null;
  try {
    const result = await webdavProvider.load(url.value, {
      url: url.value,
      user: user.value,
      password: password.value
    });
    emit('loaded', {
      name: fileNameFromUrl(url.value),
      data: result.data,
      url: url.value,
      user: user.value,
      password: password.value
    });
    open.value = false;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="t('webdav')">
    <template #body>
      <div class="flex flex-col gap-4">
        <UFormField :label="t('openUrl')" :description="t('openUrlDesc')" required>
          <UInput
            v-model="url"
            type="url"
            placeholder="https://server/path/file.kdbx"
            size="lg"
            :ui="{ root: 'w-full' }"
            autofocus
            @keydown.enter="load"
          />
        </UFormField>

        <UFormField :label="t('openUser')" :description="t('openUserDesc')">
          <UInput
            v-model="user"
            :placeholder="t('openUserPlaceholder')"
            size="lg"
            :ui="{ root: 'w-full' }"
          />
        </UFormField>

        <UFormField :label="t('openPass')" :description="t('openPassDesc')">
          <UInput
            v-model="password"
            type="password"
            :placeholder="t('openPassPlaceholder')"
            size="lg"
            :ui="{ root: 'w-full' }"
            @keydown.enter="load"
          />
        </UFormField>

        <UAlert
          v-if="error"
          color="error"
          variant="soft"
          icon="i-lucide-circle-alert"
          :title="t('openError')"
          :description="error"
        />
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton color="neutral" variant="ghost" :label="t('alertCancel')" @click="open = false" />
        <UButton
          color="primary"
          icon="i-lucide-download"
          :label="t('openOpen')"
          :loading="loading"
          :disabled="!url.trim()"
          @click="load"
        />
      </div>
    </template>
  </UModal>
</template>
