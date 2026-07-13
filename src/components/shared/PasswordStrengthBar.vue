<script setup lang="ts">
import { ref, watch } from 'vue';
import { estimateStrength, quickStrength, type PasswordStrength } from '@/domain/strength';

const props = withDefaults(defineProps<{ password: string; userInputs?: string[] }>(), {
  userInputs: () => []
});

const strength = ref<PasswordStrength>(quickStrength(props.password));

const BAR_COLORS: Record<PasswordStrength['color'], string> = {
  error: 'var(--ui-error, #ef4444)',
  warning: 'var(--ui-warning, #f59e0b)',
  primary: 'var(--ui-primary, #3b82f6)',
  success: 'var(--ui-success, #22c55e)'
};

watch(
  () => props.password,
  async (pw) => {
    strength.value = quickStrength(pw);
    if (pw) strength.value = await estimateStrength(pw, props.userInputs);
  },
  { immediate: true }
);
</script>

<template>
  <div v-if="password" class="flex items-center gap-2">
    <div class="h-1.5 flex-1 rounded-full bg-elevated overflow-hidden">
      <div
        class="kw-strength-bar h-full rounded-full"
        :style="{ width: `${Math.max(strength.value * 100, 8)}%`, backgroundColor: BAR_COLORS[strength.color] }"
      />
    </div>
    <span class="text-xs text-muted w-20 text-right">{{ strength.label }}</span>
  </div>
</template>
