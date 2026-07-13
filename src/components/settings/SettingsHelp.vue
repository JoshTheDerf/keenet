<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@/i18n';

interface Faq {
  icon: string;
  question: string;
  answer: string;
}

const faqs = computed<Faq[]>(() => [
  { icon: 'i-lucide-folder-open', question: t('setHelpFaqOpenQ'), answer: t('setHelpFaqOpenA') },
  { icon: 'i-lucide-key-round', question: t('setHelpFaqMasterQ'), answer: t('setHelpFaqMasterA') },
  { icon: 'i-lucide-file-key', question: t('setHelpFaqKeyFileQ'), answer: t('setHelpFaqKeyFileA') },
  { icon: 'i-lucide-wand-sparkles', question: t('setHelpFaqGenQ'), answer: t('setHelpFaqGenA') },
  { icon: 'i-lucide-hard-drive', question: t('setHelpFaqDataQ'), answer: t('setHelpFaqDataA') },
  { icon: 'i-lucide-cloud', question: t('setHelpFaqCloudQ'), answer: t('setHelpFaqCloudA') },
  { icon: 'i-lucide-key-square', question: t('setHelpFaqOauthQ'), answer: t('setHelpFaqOauthA') }
]);
</script>

<template>
  <div class="flex flex-col gap-6">
    <h1 class="text-xl font-semibold">{{ t('help') }}</h1>

    <UCard>
      <ul class="flex flex-col divide-y divide-default/60">
        <li v-for="faq in faqs" :key="faq.question" class="flex items-start gap-3 py-4 first:pt-0 last:pb-0">
          <UIcon :name="faq.icon" class="mt-0.5 shrink-0 text-primary text-lg" />
          <div>
            <div class="text-sm font-medium">{{ faq.question }}</div>
            <div class="text-sm text-muted mt-0.5 leading-relaxed">{{ faq.answer }}</div>
          </div>
        </li>
      </ul>
    </UCard>
  </div>
</template>
