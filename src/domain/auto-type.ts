/**
 * Auto-type sequence parsing (KeePass syntax) + a pluggable emitter.
 *
 * The parser turns a sequence like `{USERNAME}{TAB}{PASSWORD}{ENTER}` into a
 * list of ops. Emission is platform-specific: the desktop (Tauri) registers
 * a native emitter that injects real OS keystrokes; the web build falls back to
 * typing into the focused field (or copying the resolved text).
 */

export interface AutoTypeContext {
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  totp?: string;
  fields: Record<string, string>;
}

export type AutoTypeOp =
  | { type: 'text'; text: string }
  | { type: 'key'; key: string }
  | { type: 'delay'; ms: number };

export const DEFAULT_SEQUENCE = '{USERNAME}{TAB}{PASSWORD}{ENTER}';

const KEY_TOKENS = new Set([
  'TAB',
  'ENTER',
  'SPACE',
  'UP',
  'DOWN',
  'LEFT',
  'RIGHT',
  'HOME',
  'END',
  'INSERT',
  'DELETE',
  'BACKSPACE',
  'ESC',
  'ESCAPE',
  'PGUP',
  'PGDN'
]);

function resolveToken(token: string, ctx: AutoTypeContext): AutoTypeOp | null {
  const upper = token.toUpperCase();
  switch (upper) {
    case 'USERNAME':
      return { type: 'text', text: ctx.username };
    case 'PASSWORD':
      return { type: 'text', text: ctx.password };
    case 'URL':
      return { type: 'text', text: ctx.url };
    case 'TITLE':
      return { type: 'text', text: ctx.title };
    case 'NOTES':
      return { type: 'text', text: ctx.notes };
    case 'TOTP':
    case 'OTP':
      return { type: 'text', text: ctx.totp ?? '' };
    default:
      break;
  }
  if (KEY_TOKENS.has(upper)) return { type: 'key', key: upper };
  // {DELAY 500}
  const delay = /^DELAY[ =](\d+)$/i.exec(token);
  if (delay) return { type: 'delay', ms: parseInt(delay[1], 10) };
  // {S:Custom Field}
  const custom = /^S:(.+)$/i.exec(token);
  if (custom) return { type: 'text', text: ctx.fields[custom[1]] ?? '' };
  return null;
}

/** Parse a KeePass auto-type sequence into ops, resolving entry placeholders. */
export function parseSequence(sequence: string, ctx: AutoTypeContext): AutoTypeOp[] {
  const ops: AutoTypeOp[] = [];
  let literal = '';
  let i = 0;
  const flush = () => {
    if (literal) {
      ops.push({ type: 'text', text: literal });
      literal = '';
    }
  };
  while (i < sequence.length) {
    const ch = sequence[i];
    if (ch === '{') {
      const end = sequence.indexOf('}', i);
      if (end === -1) {
        literal += sequence.slice(i);
        break;
      }
      const token = sequence.slice(i + 1, end);
      flush();
      const op = resolveToken(token, ctx);
      if (op) ops.push(op);
      else literal += `{${token}}`; // unknown token → literal
      i = end + 1;
      continue;
    }
    literal += ch;
    i++;
  }
  flush();
  return ops;
}

export interface AutoTypeEmitter {
  emit(ops: AutoTypeOp[]): Promise<void>;
}

let emitter: AutoTypeEmitter | null = null;

/** Desktop registers a native emitter here at startup. */
export function registerAutoTypeEmitter(e: AutoTypeEmitter): void {
  emitter = e;
}

export function hasNativeEmitter(): boolean {
  return emitter !== null;
}

/**
 * Web fallback emitter: types text and dispatches key events into the currently
 * focused editable element. Only affects this page (browsers can't drive other
 * apps) — real cross-app auto-type requires the desktop build.
 */
const KEY_TO_DOM: Record<string, string> = {
  TAB: 'Tab',
  ENTER: 'Enter',
  SPACE: ' ',
  ESC: 'Escape',
  ESCAPE: 'Escape',
  BACKSPACE: 'Backspace',
  DELETE: 'Delete'
};

const webEmitter: AutoTypeEmitter = {
  async emit(ops) {
    const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    for (const op of ops) {
      if (op.type === 'delay') {
        await new Promise((r) => setTimeout(r, op.ms));
      } else if (op.type === 'text' && el && 'value' in el) {
        el.value += op.text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (op.type === 'key') {
        const key = KEY_TO_DOM[op.key] ?? op.key;
        el?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      }
    }
  }
};

export async function runAutoType(sequence: string, ctx: AutoTypeContext): Promise<void> {
  const ops = parseSequence(sequence, ctx);
  await (emitter ?? webEmitter).emit(ops);
}

/** Resolve a sequence to plain text (for the "copy sequence" fallback). */
export function sequenceToText(sequence: string, ctx: AutoTypeContext): string {
  return parseSequence(sequence, ctx)
    .map((op) => (op.type === 'text' ? op.text : op.type === 'key' && op.key === 'TAB' ? '\t' : ''))
    .join('');
}
