/**
 * System back (Android back button, browser back, edge swipe) closes what's on
 * top — a dialog, the menu drawer, the open entry, settings — instead of
 * leaving the app. Each open "layer" holds one history entry; the app has no
 * URL routing, so those entries carry only a marker.
 */
import { watch, onScopeDispose, type WatchSource } from 'vue';

interface Layer {
  id: number;
  close: () => void;
}

const stack: Layer[] = [];
let seq = 0;
/** history.back() calls we made ourselves, whose popstate must not close anything */
let ownPops = 0;
/** layers opened while one of our back()s was in flight: pushed once it lands */
let pending: Layer[] = [];
let listening = false;

/** Menus are short-lived and hold no history entry; back just closes them. */
function menuOpen(): boolean {
  return !!document.querySelector('[role="menu"]');
}

/** Close the topmost dialog or menu the way its own Escape handling does. */
function dismissOverlay(): void {
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
}

function pushEntry(layer: Layer): void {
  history.pushState({ kwLayer: layer.id }, '');
}

function onPopState(e: PopStateEvent): void {
  if (ownPops > 0) {
    if (--ownPops === 0) {
      const queued = pending;
      pending = [];
      for (const layer of queued) if (stack.includes(layer)) pushEntry(layer);
    }
    return;
  }
  if (menuOpen()) {
    // back closes the menu; the layer under it stays, so put its entry back
    dismissOverlay();
    const top = stack[stack.length - 1];
    if (top) pushEntry(top);
    return;
  }
  // close every layer opened after the entry we landed on
  const landed = (e.state as { kwLayer?: number } | null)?.kwLayer ?? 0;
  while (stack.length && stack[stack.length - 1].id > landed) stack.pop()!.close();
}

function listen(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('popstate', onPopState);
}

/** Open a layer; returns a function to call when the UI closes it itself. */
export function pushLayer(close: () => void): () => void {
  listen();
  const layer = { id: ++seq, close };
  stack.push(layer);
  if (ownPops > 0) pending.push(layer);
  else pushEntry(layer);
  return () => {
    const i = stack.indexOf(layer);
    if (i === -1) return; // already closed by back
    stack.splice(i, 1);
    const queued = pending.indexOf(layer);
    if (queued !== -1) {
      pending.splice(queued, 1); // never reached history
    } else if (i === stack.length) {
      // it was on top: step back over its entry
      ownPops++;
      history.back();
    }
    // a layer closed from underneath keeps its (now inert) entry; landing on
    // it later closes nothing because no open layer is newer
  };
}

/** Keep a layer in step with an open/closed state. */
export function useBackLayer(isOpen: WatchSource<boolean>, close: () => void): void {
  let release: (() => void) | null = null;
  watch(
    isOpen,
    (open) => {
      if (open && !release) release = pushLayer(close);
      else if (!open && release) {
        release();
        release = null;
      }
    },
    { immediate: true }
  );
  onScopeDispose(() => {
    release?.();
    release = null;
  });
}

/**
 * The Android back button (Capacitor): returns false when there is nothing
 * left to close, so the caller can send the app to the background.
 */
export function handleSystemBack(): boolean {
  if (stack.length) {
    history.back();
    return true;
  }
  if (menuOpen()) {
    dismissOverlay();
    return true;
  }
  return false;
}

/**
 * Every dialog (modal, sheet, confirmation) gets a layer while it is open, so
 * back closes it — whichever component opened it. Dialogs render into <body>
 * through portals, so watching <body> catches them all.
 */
export function trackDialogs(): void {
  const open = new Map<Element, () => void>();
  let scheduled = false;
  const sync = () => {
    scheduled = false;
    const now = new Set(
      Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]')).filter(
        (el) => el.getAttribute('data-state') !== 'closed'
      )
    );
    for (const [el, release] of open) {
      if (!now.has(el)) {
        open.delete(el);
        release();
      }
    }
    for (const el of now) if (!open.has(el)) open.set(el, pushLayer(dismissOverlay));
  };
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(sync);
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state'] });
}
