import { describe, it, expect } from 'vitest';
import { resolveFieldReferences, hasFieldReferences, type RefEntry } from './references';
import { passwordEntropy, isPin, auditEntries } from './audit';
import { parseCsv, guessMapping, rowsToEntries } from './csv';
import { parseSequence, sequenceToText, DEFAULT_SEQUENCE, type AutoTypeContext } from './auto-type';
import type { EntryVm } from '@/types';

const refEntries: RefEntry[] = [
  { uuidHex: 'aabbccdd', title: 'Bank', username: 'joe', password: 'hunter2', url: 'https://bank.com', notes: '' }
];

describe('field references', () => {
  it('detects references', () => {
    expect(hasFieldReferences('{REF:P@I:aabbccdd}')).toBe(true);
    expect(hasFieldReferences('plain')).toBe(false);
  });
  it('resolves by UUID', () => {
    expect(resolveFieldReferences('{REF:P@I:aabbccdd}', refEntries)).toBe('hunter2');
    expect(resolveFieldReferences('user={REF:U@I:AABBCCDD}', refEntries)).toBe('user=joe');
  });
  it('resolves by field match', () => {
    expect(resolveFieldReferences('{REF:P@T:Bank}', refEntries)).toBe('hunter2');
  });
  it('leaves unknown references intact', () => {
    expect(resolveFieldReferences('{REF:P@I:0000}', refEntries)).toBe('{REF:P@I:0000}');
  });
});

describe('audit', () => {
  it('estimates entropy and detects pins', () => {
    expect(passwordEntropy('')).toBe(0);
    expect(passwordEntropy('aaaaaaaa')).toBeGreaterThan(0);
    expect(passwordEntropy('Xy9!Kp2@Lm5#Qr8$')).toBeGreaterThan(passwordEntropy('abc'));
    expect(isPin('1234')).toBe(true);
    expect(isPin('12ab')).toBe(false);
  });
  it('flags weak and duplicate passwords', () => {
    const mk = (id: string, password: string): EntryVm =>
      ({ id, fileId: 'f', password, updated: Date.now(), inTrash: false } as unknown as EntryVm);
    const issues = auditEntries([mk('1', '123'), mk('2', 'abc'), mk('3', 'abc')], {
      excludePins: false
    });
    expect(issues.some((i) => i.kind === 'weak')).toBe(true);
    expect(issues.filter((i) => i.kind === 'duplicate').map((i) => i.entryId).sort()).toEqual(['2', '3']);
  });
  it('excludes pins when requested', () => {
    const mk = (id: string, password: string): EntryVm =>
      ({ id, fileId: 'f', password, updated: Date.now(), inTrash: false } as unknown as EntryVm);
    const issues = auditEntries([mk('1', '1234')], { excludePins: true });
    expect(issues.filter((i) => i.kind === 'weak')).toHaveLength(0);
  });
});

describe('csv import', () => {
  it('parses quoted fields with embedded commas and newlines', () => {
    const rows = parseCsv('Title,User\n"a,b","line1\nline2"\n');
    expect(rows).toEqual([
      ['Title', 'User'],
      ['a,b', 'line1\nline2']
    ]);
  });
  it('handles escaped quotes', () => {
    expect(parseCsv('"she said ""hi"""')).toEqual([['she said "hi"']]);
  });
  it('guesses a header mapping', () => {
    const mapping = guessMapping(['Name', 'Login', 'Password', 'Website', 'Notes']);
    expect(mapping[0]).toBe('Title');
    expect(mapping[1]).toBe('UserName');
    expect(mapping[2]).toBe('Password');
    expect(mapping[3]).toBe('URL');
    expect(mapping[4]).toBe('Notes');
  });
  it('builds entries from rows + mapping', () => {
    const rows = parseCsv('Name,Password\nGitHub,secret\n');
    const entries = rowsToEntries(rows, guessMapping(rows[0]), true);
    expect(entries).toHaveLength(1);
    const pw = entries[0].fields.find((f) => f.name === 'Password');
    expect(pw?.value).toBe('secret');
    expect(pw?.protected).toBe(true);
  });
});

describe('auto-type', () => {
  const ctx: AutoTypeContext = {
    title: 'T',
    username: 'alice',
    password: 'p@ss',
    url: 'u',
    notes: 'n',
    totp: '123456',
    fields: { PIN: '9999' }
  };
  it('parses the default sequence', () => {
    const ops = parseSequence(DEFAULT_SEQUENCE, ctx);
    expect(ops).toEqual([
      { type: 'text', text: 'alice' },
      { type: 'key', key: 'TAB' },
      { type: 'text', text: 'p@ss' },
      { type: 'key', key: 'ENTER' }
    ]);
  });
  it('supports custom fields, totp and delay', () => {
    const ops = parseSequence('{S:PIN}{DELAY 200}{TOTP}', ctx);
    expect(ops).toEqual([
      { type: 'text', text: '9999' },
      { type: 'delay', ms: 200 },
      { type: 'text', text: '123456' }
    ]);
  });
  it('flattens a sequence to text with tabs', () => {
    expect(sequenceToText(DEFAULT_SEQUENCE, ctx)).toBe('alice\tp@ss');
  });
});
