/**
 * Shared open-state for app-level overlays (command palette, audit panel,
 * import dialog). Module-scoped refs so the titlebar, keyboard shortcuts and
 * the command palette can all drive the same dialogs without prop drilling.
 */
import { ref, type Ref } from 'vue';

const commandPaletteOpen = ref(false);
const auditOpen = ref(false);
const importOpen = ref(false);

export function useOverlays(): {
  commandPaletteOpen: Ref<boolean>;
  auditOpen: Ref<boolean>;
  importOpen: Ref<boolean>;
} {
  return { commandPaletteOpen, auditOpen, importOpen };
}

export function toggleCommandPalette(): void {
  commandPaletteOpen.value = !commandPaletteOpen.value;
}
