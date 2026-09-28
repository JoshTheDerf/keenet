<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, useTemplateRef } from 'vue';
import { t } from '@/i18n';
import { useVaultStore } from '@/stores/vault';
import { useClipboard } from '@/composables/useClipboard';
import { parseOtpUri, computeOtp, totpTimeLeft, type OtpParams } from '@/domain/otp';
import TextPromptModal from '@/components/shared/TextPromptModal.vue';
import ConfirmModal from '@/components/shared/ConfirmModal.vue';
import { errorMessage } from '@/components/shared/format';

// Minimal typing for the experimental BarcodeDetector API (not in lib.dom).
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
}

const props = defineProps<{ fileId: string; entryId: string; otp?: string }>();

const vault = useVaultStore();
const { copy } = useClipboard();

const params = ref<OtpParams | null>(null);
const code = ref('');
const timeLeft = ref(0);
const error = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;
let lastCounter = -1;

const barcodeSupported = typeof window !== 'undefined' && 'BarcodeDetector' in window;

// ---- QR scan state -------------------------------------------------------
const scanOpen = ref(false);
const scanError = ref('');
const video = useTemplateRef<HTMLVideoElement>('video');
let stream: MediaStream | null = null;
let scanTimer: ReturnType<typeof setInterval> | undefined;

/** The raw otp field may itself be a `{REF:...}` reference. */
const rawOtp = computed(() =>
  props.otp ? vault.resolveReference(props.fileId, props.otp) : props.otp
);

const formattedCode = computed(() => {
  const c = code.value;
  if (!c) return '––––––';
  const mid = Math.ceil(c.length / 2);
  return `${c.slice(0, mid)} ${c.slice(mid)}`;
});

const ringStyle = computed(() => {
  const period = params.value?.period ?? 30;
  const pct = Math.max(0, Math.min(100, (timeLeft.value / period) * 100));
  return {
    background: `conic-gradient(var(--ui-primary, #3b82f6) ${pct}%, var(--ui-bg-elevated, #e5e7eb) ${pct}%)`
  };
});

async function tick(): Promise<void> {
  const p = params.value;
  if (!p) return;
  if (p.type === 'totp') timeLeft.value = totpTimeLeft(p.period);
  const counter = p.type === 'hotp' ? p.counter : Math.floor(Date.now() / 1000 / p.period);
  if (counter !== lastCounter) {
    lastCounter = counter;
    code.value = await computeOtp(p);
  }
}

function init(): void {
  lastCounter = -1;
  code.value = '';
  error.value = false;
  const uri = rawOtp.value;
  if (!uri) {
    params.value = null;
    return;
  }
  try {
    params.value = parseOtpUri(uri);
    void tick();
  } catch {
    params.value = null;
    error.value = true;
  }
}

const manualOpen = ref(false);

function addOtp(): void {
  manualOpen.value = true;
}

function confirmOtp(uri: string): void {
  vault.updateField(props.fileId, props.entryId, 'otp', uri);
}

const removeOpen = ref(false);

function removeOtp(): void {
  vault.removeField(props.fileId, props.entryId, 'otp');
}

// ---- QR scanning ---------------------------------------------------------
function stopScan(): void {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = undefined;
  }
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
    stream = null;
  }
}

async function startScan(): Promise<void> {
  scanError.value = '';
  scanOpen.value = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const el = video.value;
    if (el) {
      el.srcObject = stream;
      await el.play();
    }
    const Ctor = (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector;
    const detector = new Ctor({ formats: ['qr_code'] });
    scanTimer = setInterval(() => void detectFrame(detector), 400);
  } catch (e) {
    scanError.value = errorMessage(e);
    stopScan();
  }
}

async function detectFrame(detector: BarcodeDetectorLike): Promise<void> {
  const el = video.value;
  if (!el || el.readyState < 2) return;
  try {
    const results = await detector.detect(el);
    for (const r of results) {
      const value = r.rawValue.trim();
      if (value.toLowerCase().startsWith('otpauth://')) {
        vault.updateField(props.fileId, props.entryId, 'otp', value);
        closeScan();
        return;
      }
    }
  } catch {
    /* transient decode errors are ignored */
  }
}

function closeScan(): void {
  stopScan();
  scanOpen.value = false;
}

watch(scanOpen, (open) => {
  if (!open) stopScan();
});

watch(rawOtp, init);

onMounted(() => {
  init();
  timer = setInterval(() => void tick(), 1000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
  stopScan();
});
</script>

<template>
  <UFormField :label="t('detOtpField')">
    <div v-if="params" class="flex items-center gap-3">
      <span class="font-mono text-xl tracking-widest tabular-nums">{{ formattedCode }}</span>

      <div
        v-if="params.type === 'totp'"
        class="relative flex items-center justify-center rounded-full"
        :style="ringStyle"
        style="width: 2rem; height: 2rem"
        :title="`${timeLeft}s`"
      >
        <span class="absolute inset-0.5 flex items-center justify-center rounded-full bg-default text-xs tabular-nums">
          {{ timeLeft }}
        </span>
      </div>

      <UTooltip :text="t('detMenuCopyOtp')">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-copy"
          :aria-label="t('detMenuCopyOtp')"
          :disabled="!code"
          @click="copy(code, t('detOtpField'))"
        />
      </UTooltip>
      <UTooltip :text="t('detOtpRemove')">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-x"
          :aria-label="t('detOtpRemove')"
          @click="removeOpen = true"
        />
      </UTooltip>
    </div>

    <div v-else class="flex items-center gap-2">
      <UButton color="neutral" variant="soft" size="sm" icon="i-lucide-timer" @click="addOtp">
        {{ t('detSetupOtp') }}
      </UButton>
      <UButton
        v-if="barcodeSupported"
        color="neutral"
        variant="soft"
        size="sm"
        icon="i-lucide-scan-line"
        @click="startScan"
      >
        {{ t('detSetupOtpScanButton') }}
      </UButton>
      <template v-if="error">
        <span class="text-xs text-error">{{ t('detOtpInvalid') }}</span>
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-x"
          :aria-label="t('detOtpRemove')"
          @click="removeOpen = true"
        />
      </template>
    </div>
  </UFormField>

  <ConfirmModal
    v-model:open="removeOpen"
    :title="t('detOtpRemove')"
    :description="t('detOtpRemoveBody')"
    :confirm-label="t('remove')"
    @confirm="removeOtp"
  />

  <TextPromptModal
    v-model:open="manualOpen"
    :title="t('detSetupOtpManualButton')"
    :placeholder="t('detSetupOtpManualPlaceholder')"
    @confirm="confirmOtp"
  />

  <UModal v-model:open="scanOpen" :title="t('detSetupOtpScanButton')">
    <template #body>
      <div class="flex flex-col gap-3">
        <UAlert
          v-if="scanError"
          color="error"
          variant="soft"
          icon="i-lucide-camera-off"
          :title="t('detOtpCameraError')"
          :description="scanError"
        />
        <video
          v-show="!scanError"
          ref="video"
          class="w-full rounded-md bg-black"
          muted
          playsinline
        />
        <p class="text-xs text-muted">{{ t('detSetupOtpAlert') }}</p>
      </div>
    </template>
    <template #footer>
      <UButton color="neutral" variant="soft" @click="closeScan">{{ t('alertClose') }}</UButton>
    </template>
  </UModal>
</template>
