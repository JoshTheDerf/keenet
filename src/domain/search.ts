/** Entry search, filtering and sorting — pure functions over EntryVm lists. */
import type { EntryVm, MenuSelection, SortField, SortDir } from '@/types';

export interface SearchOptions {
  text?: string;
  caseSensitive?: boolean;
  regex?: boolean;
  /** search within protected fields (password/custom protected) */
  includeProtected?: boolean;
}

function buildMatcher(opts: SearchOptions): (haystack: string) => boolean {
  const text = opts.text ?? '';
  if (!text) return () => true;
  if (opts.regex) {
    let re: RegExp;
    try {
      re = new RegExp(text, opts.caseSensitive ? '' : 'i');
    } catch {
      return () => false;
    }
    return (h) => re.test(h);
  }
  const needle = opts.caseSensitive ? text : text.toLowerCase();
  return (h) => (opts.caseSensitive ? h : h.toLowerCase()).includes(needle);
}

function entryHaystack(entry: EntryVm, includeProtected: boolean): string {
  const parts = [entry.title, entry.username, entry.url, entry.notes, entry.tags.join(' ')];
  for (const field of entry.fields) {
    if (field.protected && !includeProtected) continue;
    parts.push(field.name, field.value);
  }
  if (includeProtected) parts.push(entry.password);
  return parts.join('\n');
}

/** Apply the left-menu selection filter (before text search). */
export function applyMenuFilter(entries: EntryVm[], selection: MenuSelection): EntryVm[] {
  switch (selection.type) {
    case 'all':
      return entries.filter((e) => !e.inTrash);
    case 'trash':
      return entries.filter((e) => e.inTrash && (!selection.fileId || e.fileId === selection.fileId));
    case 'group':
      return entries.filter((e) => e.fileId === selection.fileId && e.groupId === selection.groupId);
    case 'tag':
      return entries.filter((e) => !e.inTrash && e.tags.includes(selection.tag));
    case 'color':
      return entries.filter((e) => !e.inTrash && e.color === selection.color);
    case 'expired':
      return entries.filter((e) => !e.inTrash && e.expired);
    default:
      return entries;
  }
}

export function searchEntries(entries: EntryVm[], opts: SearchOptions): EntryVm[] {
  const match = buildMatcher(opts);
  const includeProtected = opts.includeProtected ?? false;
  return entries.filter((e) => match(entryHaystack(e, includeProtected)));
}

function compare(a: EntryVm, b: EntryVm, field: SortField): number {
  switch (field) {
    case 'title':
      return a.title.localeCompare(b.title);
    case 'username':
      return a.username.localeCompare(b.username);
    case 'url':
      return a.url.localeCompare(b.url);
    case 'created':
      return a.created - b.created;
    case 'updated':
      return a.updated - b.updated;
    case 'expires':
      return (a.expires ?? Infinity) - (b.expires ?? Infinity);
    default:
      return 0;
  }
}

export function sortEntries(entries: EntryVm[], field: SortField, dir: SortDir): EntryVm[] {
  // Fold the direction into the comparator (rather than reversing the sorted
  // array) so untitled entries stay last in both directions and the relative
  // order of ties is never flipped.
  const sign = dir === 'desc' ? -1 : 1;
  return entries.slice().sort((a, b) => {
    // Untitled entries sort last, mirroring KeeWeb behavior.
    if (field === 'title') {
      if (!a.title && b.title) return 1;
      if (a.title && !b.title) return -1;
    }
    return sign * compare(a, b, field);
  });
}

export interface ListPipelineInput {
  entries: EntryVm[];
  selection: MenuSelection;
  search: SearchOptions;
  sortField: SortField;
  sortDir: SortDir;
}

/** Full list derivation: menu filter → text search → sort. */
export function deriveList(input: ListPipelineInput): EntryVm[] {
  const filtered = applyMenuFilter(input.entries, input.selection);
  const searched = searchEntries(filtered, input.search);
  return sortEntries(searched, input.sortField, input.sortDir);
}
