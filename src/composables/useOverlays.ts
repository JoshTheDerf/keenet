/**
 * Shared open-state for app-level overlays (command palette, audit panel,
 * import dialog). Module-scoped refs so the titlebar, keyboard shortcuts and
 * the command palette can all drive the same dialogs without prop drilling.
 */
import { ref, type Ref } from 'vue';

const commandPaletteOpen = ref(false);
const auditOpen = ref(false);
const importOpen = ref(false);
/** Tab the import dialog opens on next (it falls back to CSV after each open). */
const importMode = ref<'csv' | 'kdbx' | 'otp'>('csv');
/** The "add a one-time code" scanner in the codes view. */
const otpSetupOpen = ref(false);

export function useOverlays(): {
  commandPaletteOpen: Ref<boolean>;
  auditOpen: Ref<boolean>;
  importOpen: Ref<boolean>;
  importMode: Ref<'csv' | 'kdbx' | 'otp'>;
  otpSetupOpen: Ref<boolean>;
} {
  return { commandPaletteOpen, auditOpen, importOpen, importMode, otpSetupOpen };
}

export function toggleCommandPalette(): void {
  commandPaletteOpen.value = !commandPaletteOpen.value;
}
