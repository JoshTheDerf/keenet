<script setup lang="ts">
import { t } from '@/i18n';
import KeeNetLogo from '@/components/shared/KeeNetLogo.vue';

const version = '2.0.0';
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center gap-3">
      <KeeNetLogo class="size-12 shrink-0" />
      <div>
        <div class="text-2xl font-bold tracking-tight">KeeNet</div>
        <div class="text-sm text-muted">{{ t('setAboutVersion', version) }}</div>
      </div>
    </div>

    <UCard>
      <p class="text-sm leading-relaxed">{{ t('setAboutTagline') }}</p>

      <p class="mt-3 text-sm text-muted leading-relaxed">
        {{ t('setAboutContinuation1') }}
        <a
          href="https://github.com/keeweb/keeweb"
          target="_blank"
          rel="noopener noreferrer"
          class="text-primary hover:underline"
        >KeeWeb</a>{{ t('setAboutContinuation2') }}
      </p>

      <div class="mt-4 flex items-start gap-2 text-sm text-muted">
        <UIcon name="i-lucide-lock" class="mt-0.5 shrink-0 text-success" />
        <span>{{ t('setAboutPrivacy') }}</span>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="text-base font-semibold">{{ t('setAboutStorageBackends') }}</h2>
      </template>
      <p class="text-sm text-muted mb-3">{{ t('setAboutStorageIntro') }}</p>
      <ul class="flex flex-col gap-2 text-sm">
        <li class="flex items-center gap-2">
          <UIcon name="i-lucide-folder-open" class="text-muted shrink-0" />
          <span>{{ t('setAboutStorageLocal') }}</span>
        </li>
        <li class="flex items-center gap-2">
          <UIcon name="i-lucide-server" class="text-muted shrink-0" />
          <span>{{ t('setAboutStorageWebdav') }}</span>
        </li>
        <li class="flex items-center gap-2">
          <UIcon name="i-lucide-cloud" class="text-muted shrink-0" />
          <span>{{ t('setAboutStorageCloud') }}</span>
        </li>
      </ul>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="text-base font-semibold">{{ t('setAboutLinks') }}</h2>
      </template>
      <ul class="flex flex-col gap-2 text-sm">
        <li class="flex items-center gap-2">
          <UIcon name="i-lucide-github" class="text-muted" />
          <a
            href="https://github.com/keeweb/keeweb"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary hover:underline"
          >
            {{ t('setAboutOriginalProject') }} — github.com/keeweb/keeweb
          </a>
        </li>
        <li class="flex items-center gap-2">
          <UIcon name="i-lucide-scale" class="text-muted" />
          <a
            href="https://github.com/keeweb/keeweb/blob/master/MIT-LICENSE.txt"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary hover:underline"
          >
            {{ t('setAboutMitLicense') }}
          </a>
        </li>
      </ul>
    </UCard>
  </div>
</template>
