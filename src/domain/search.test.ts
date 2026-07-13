import { describe, it, expect } from 'vitest';
import { applyMenuFilter, searchEntries, sortEntries, deriveList } from './search';
import type { EntryVm } from '@/types';

function entry(partial: Partial<EntryVm>): EntryVm {
  return {
    id: 'x',
    fileId: 'f1',
    groupId: 'g1',
    title: '',
    username: '',
    password: '',
    passwordProtected: true,
    url: '',
    extraUrls: [],
    notes: '',
    fields: [],
    tags: [],
    icon: 0,
    attachments: [],
    created: 0,
    updated: 0,
    expired: false,
    historyLength: 0,
    inTrash: false,
    groupPath: [],
    autoType: { enabled: true, obfuscation: false, items: [] },
    hasReferences: false,
    ...partial
  };
}

const entries: EntryVm[] = [
  entry({ id: '1', title: 'GitHub', username: 'octocat', url: 'https://github.com', tags: ['dev'], groupId: 'g1' }),
  entry({ id: '2', title: 'Gmail', username: 'me@gmail.com', tags: ['mail'], color: 'red', groupId: 'g2' }),
  entry({ id: '3', title: 'Old', inTrash: true }),
  entry({ id: '4', title: 'Expiring', expired: true, tags: ['dev'] })
];

describe('applyMenuFilter', () => {
  it('all excludes trash', () => {
    expect(applyMenuFilter(entries, { type: 'all' }).map((e) => e.id)).toEqual(['1', '2', '4']);
  });
  it('trash only', () => {
    expect(applyMenuFilter(entries, { type: 'trash' }).map((e) => e.id)).toEqual(['3']);
  });
  it('group filter', () => {
    expect(applyMenuFilter(entries, { type: 'group', fileId: 'f1', groupId: 'g2' }).map((e) => e.id)).toEqual(['2']);
  });
  it('tag filter (excludes trash)', () => {
    expect(applyMenuFilter(entries, { type: 'tag', tag: 'dev' }).map((e) => e.id)).toEqual(['1', '4']);
  });
  it('color filter', () => {
    expect(applyMenuFilter(entries, { type: 'color', color: 'red' }).map((e) => e.id)).toEqual(['2']);
  });
  it('expired filter', () => {
    expect(applyMenuFilter(entries, { type: 'expired' }).map((e) => e.id)).toEqual(['4']);
  });
});

describe('searchEntries', () => {
  it('matches title/username/url case-insensitively', () => {
    expect(searchEntries(entries, { text: 'git' }).map((e) => e.id)).toEqual(['1']);
    expect(searchEntries(entries, { text: 'GMAIL' }).map((e) => e.id)).toEqual(['2']);
  });
  it('respects case sensitivity', () => {
    // 'GITHUB' matches neither the 'GitHub' title nor the 'github.com' URL.
    expect(searchEntries(entries, { text: 'GITHUB', caseSensitive: true })).toHaveLength(0);
    // exact-case title match still works
    expect(searchEntries(entries, { text: 'GitHub', caseSensitive: true }).map((e) => e.id)).toEqual(['1']);
  });
  it('supports regex', () => {
    expect(searchEntries(entries, { text: '^G', regex: true }).map((e) => e.id).sort()).toEqual(['1', '2']);
  });
  it('bad regex yields no matches', () => {
    expect(searchEntries(entries, { text: '(', regex: true })).toHaveLength(0);
  });
  it('empty query returns all', () => {
    expect(searchEntries(entries, { text: '' })).toHaveLength(entries.length);
  });
});

describe('sortEntries', () => {
  it('sorts by title asc and puts untitled last', () => {
    const list = [entry({ id: 'a', title: 'Zebra' }), entry({ id: 'b', title: '' }), entry({ id: 'c', title: 'Apple' })];
    expect(sortEntries(list, 'title', 'asc').map((e) => e.id)).toEqual(['c', 'a', 'b']);
  });
  it('sorts desc', () => {
    const list = [entry({ id: 'a', updated: 1 }), entry({ id: 'b', updated: 3 }), entry({ id: 'c', updated: 2 })];
    expect(sortEntries(list, 'updated', 'desc').map((e) => e.id)).toEqual(['b', 'c', 'a']);
  });
  it('sorts by title desc and still puts untitled last', () => {
    const list = [entry({ id: 'a', title: 'Zebra' }), entry({ id: 'b', title: '' }), entry({ id: 'c', title: 'Apple' })];
    expect(sortEntries(list, 'title', 'desc').map((e) => e.id)).toEqual(['a', 'c', 'b']);
  });
  it('keeps multiple untitled entries last in both directions without flipping ties', () => {
    const list = [
      entry({ id: 'u1', title: '' }),
      entry({ id: 'a', title: 'Apple' }),
      entry({ id: 'u2', title: '' }),
      entry({ id: 'z', title: 'Zebra' })
    ];
    expect(sortEntries(list, 'title', 'asc').map((e) => e.id)).toEqual(['a', 'z', 'u1', 'u2']);
    expect(sortEntries(list, 'title', 'desc').map((e) => e.id)).toEqual(['z', 'a', 'u1', 'u2']);
  });
});

describe('deriveList', () => {
  it('applies filter → search → sort together', () => {
    const result = deriveList({
      entries,
      selection: { type: 'tag', tag: 'dev' },
      search: { text: 'exp' },
      sortField: 'title',
      sortDir: 'asc'
    });
    expect(result.map((e) => e.id)).toEqual(['4']);
  });
});
