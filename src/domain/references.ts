/**
 * KeePass field-reference resolution.
 *
 * References look like `{REF:<want>@<searchIn>:<text>}` where the codes are
 * T=Title, U=UserName, P=Password, A=URL, N=Notes, I=UUID, O=Other.
 * e.g. `{REF:P@I:46C9B1FFBD4ABC4BBB260C6190BAD20C}` = the password of the
 * entry whose UUID is that hex string.
 */

export type RefFieldCode = 'T' | 'U' | 'P' | 'A' | 'N' | 'I' | 'O';

export interface RefEntry {
  uuidHex: string;
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
}

const REF_RE = /\{REF:([TUPANI O])@([TUPANI O]):([^}]+)\}/gi;
const MAX_DEPTH = 3;

function fieldValue(entry: RefEntry, code: RefFieldCode): string {
  switch (code.toUpperCase()) {
    case 'T':
      return entry.title;
    case 'U':
      return entry.username;
    case 'P':
      return entry.password;
    case 'A':
      return entry.url;
    case 'N':
      return entry.notes;
    case 'I':
      return entry.uuidHex;
    default:
      return '';
  }
}

function findEntry(entries: RefEntry[], searchIn: RefFieldCode, text: string): RefEntry | undefined {
  const code = searchIn.toUpperCase() as RefFieldCode;
  if (code === 'I') {
    const target = text.toLowerCase().replace(/[^0-9a-f]/g, '');
    return entries.find((e) => e.uuidHex.toLowerCase() === target);
  }
  const needle = text.toLowerCase();
  return entries.find((e) => fieldValue(e, code).toLowerCase().includes(needle));
}

/** Replace all `{REF:...}` tokens in `value` using the given entry set. */
export function resolveFieldReferences(value: string, entries: RefEntry[], depth = 0): string {
  if (depth >= MAX_DEPTH || !value || value.indexOf('{REF:') === -1) return value;
  return value.replace(REF_RE, (match, want: string, searchIn: string, text: string) => {
    const entry = findEntry(entries, searchIn as RefFieldCode, text);
    if (!entry) return match;
    const resolved = fieldValue(entry, want as RefFieldCode);
    return resolveFieldReferences(resolved, entries, depth + 1);
  });
}

export function hasFieldReferences(value: string): boolean {
  return typeof value === 'string' && value.indexOf('{REF:') !== -1;
}
