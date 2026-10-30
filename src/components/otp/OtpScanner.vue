<script setup lang="ts">
// Finds a one-time code QR code: live from the camera, from a chosen image, or
// from a pasted screenshot (the usual case on a desktop, where the code is on
// the same screen). Emits the decoded setups; stops the camera when hidden.
import { ref, onMounted, onUnmounted, useTemplateRef } from 'vue';
import { t } from '@/i18n';
import { createQrReader, otpTokensFromQr, readQrFromBlob, type QrReader } from '@/domain/qr';
import type { ImportedToken } from '@/domain/otp-import';

const emit = defineEmits<{ found: [tokens: ImportedToken[]] }>();

const video = useTemplateRef<HTMLVideoElement>('video');
const fileInput = useTemplateRef<HTMLInputElement>('fileInput');
const cameraState = ref<'starting' | 'on' | 'off'>('starting');
const cameraError = ref('');
const message = ref('');
const busy = ref(false);
let stream: MediaStream | null = null;
let reader: QrReader | null = null;
let frame = 0;
let lastScan = 0;
let stopped = false;
let lastWrong = '';

const cameraAvailable = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

function handle(values: string[]): boolean {
  for (const v of values) {
    const tokens = otpTokensFromQr(v);
    if (tokens.length) {
      message.value = '';
      stop();
      emit('found', tokens);
      return true;
    }
    lastWrong = v;
  }
  if (lastWrong) message.value = t('detOtpQrWrongBody');
  return false;
}

async function startCamera(): Promise<void> {
  if (!cameraAvailable) {
    cameraState.value = 'off';
    return;
  }
  cameraState.value = 'starting';
  cameraError.value = '';
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    if (stopped) return stop();
    const el = video.value;
    if (!el) return stop();
    el.srcObject = stream;
    await el.play();
    reader ??= await createQrReader();
    cameraState.value = 'on';
    frame = requestAnimationFrame(scanLoop);
  } catch (e) {
    stop();
    cameraState.value = 'off';
    const name = (e as { name?: string })?.name;
    cameraError.value =
      name === 'NotAllowedError' || name === 'SecurityError'
        ? t('otpCameraDenied')
        : name === 'NotFoundError' || name === 'OverconstrainedError'
          ? t('otpCameraMissing')
          : t('otpCameraFailed');
  }
}

async function scanLoop(ts: number): Promise<void> {
  if (stopped || !stream) return;
  const el = video.value;
  // ~6 attempts a second keeps phones cool and is plenty to catch a steady code
  if (el && reader && el.readyState >= 2 && ts - lastScan > 160) {
    lastScan = ts;
    try {
      if (handle(await reader(el))) return;
    } catch {
      /* a frame that fails to decode is just skipped */
    }
  }
  if (!stopped && stream) frame = requestAnimationFrame((t) => void scanLoop(t));
}

function stop(): void {
  cancelAnimationFrame(frame);
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
    stream = null;
  }
  if (video.value) video.value.srcObject = null;
}

async function readImage(blob: Blob): Promise<void> {
  busy.value = true;
  message.value = '';
  lastWrong = '';
  try {
    const values = await readQrFromBlob(blob);
    if (!handle(values) && !values.length) message.value = t('otpNoQrInImage');
  } catch {
    message.value = t('detOtpImageErrorBody');
  } finally {
    busy.value = false;
  }
}

function onFile(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) void readImage(file);
}

function onPaste(e: ClipboardEvent): void {
  const items = e.clipboardData?.items ?? [];
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        e.preventDefault();
        void readImage(file);
        return;
      }
    }
  }
  // a pasted otpauth:// link works too
  const text = e.clipboardData?.getData('text') ?? '';
  if (/^otpauth(-migration)?:\/\//i.test(text.trim())) {
    e.preventDefault();
    if (!handle([text])) message.value = t('detOtpQrWrongBody');
  }
}

onMounted(() => {
  window.addEventListener('paste', onPaste);
  void startCamera();
});

onUnmounted(() => {
  stopped = true;
  window.removeEventListener('paste', onPaste);
  stop();
});
</script>

<template>
  <div class="flex flex-col gap-3">
    <div
      v-if="cameraAvailable && cameraState !== 'off'"
      class="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-black"
    >
      <video ref="video" class="size-full object-cover" muted playsinline autoplay />
      <!-- viewfinder: shows where to hold the code -->
      <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div class="size-3/5 max-h-[70%] aspect-square rounded-2xl ring-[999px] ring-black/35 border-2 border-white/80" />
      </div>
      <div
        v-if="cameraState === 'starting'"
        class="absolute inset-0 flex items-center justify-center text-sm text-white/80"
      >
        <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin mr-2" />{{ t('otpCameraStarting') }}
      </div>
      <p
        v-else
        class="absolute inset-x-0 bottom-0 p-2 text-center text-sm text-white bg-gradient-to-t from-black/70"
      >
        {{ t('otpPointCamera') }}
      </p>
    </div>

    <UAlert
      v-else-if="cameraError"
      color="neutral"
      variant="subtle"
      icon="i-lucide-camera-off"
      :title="cameraError"
      :description="t('otpUseImageInstead')"
    />

    <div class="flex flex-wrap items-center gap-2">
      <UButton
        color="neutral"
        variant="soft"
        icon="i-lucide-image"
        :loading="busy"
        :label="t('otpChooseImage')"
        @click="fileInput?.click()"
      />
      <UButton
        v-if="cameraAvailable && cameraState === 'off'"
        color="neutral"
        variant="ghost"
        icon="i-lucide-camera"
        :label="t('otpTryCamera')"
        @click="startCamera"
      />
      <span class="text-xs text-muted max-sm:hidden">{{ t('otpPasteHint') }}</span>
      <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFile" />
    </div>

    <p v-if="message" class="text-sm text-warning" role="status">{{ message }}</p>
  </div>
</template>
