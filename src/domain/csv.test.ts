// Edge cases beyond the basics in ported.test.ts (embedded commas/newlines,
// escaped quotes and simple header guessing are covered there).
import { describe, it, expect } from 'vitest';
import { parseCsv, guessMapping, rowsToEntries } from './csv';

describe('parseCsv edge cases', () => {
  it('handles CRLF line endings without leaking \\r into fields', () => {
    expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd']
    ]);
  });

  it('preserves CRLF verbatim inside quoted fields (RFC 4180)', () => {
    // \r is only a line-ending outside quotes; quoted content is kept as-is
    expect(parseCsv('"line1\r\nline2",x')).toEqual([['line1\r\nline2', 'x']]);
  });

  it('strips a leading UTF-8 BOM', () => {
    expect(parseCsv('﻿name,password\na,b')).toEqual([
      ['name', 'password'],
      ['a', 'b']
    ]);
  });

  it('does not emit an empty row for a trailing newline', () => {
    expect(parseCsv('a,b\n')).toEqual([['a', 'b']]);
  });

  it('skips fully empty rows but keeps rows with any non-empty cell', () => {
    expect(parseCsv('a\n\n,\n,x\nb')).toEqual([['a'], ['', 'x'], ['b']]);
  });

  it('handles empty cells and a quoted empty string', () => {
    expect(parseCsv('a,,c\n"",x,')).toEqual([
      ['a', '', 'c'],
      ['', 'x', '']
    ]);
  });

  it('handles a field that is only escaped quotes', () => {
    expect(parseCsv('""""')).toEqual([['"']]);
    expect(parseCsv('""""""')).toEqual([['""']]);
  });

  it('does not throw on an unterminated quote and keeps the rest as one field', () => {
    expect(parseCsv('"abc,def\nrest')).toEqual([['abc,def\nrest']]);
  });

  it('parses a comma inside quotes directly followed by a delimiter', () => {
    expect(parseCsv('"a,b",c')).toEqual([['a,b', 'c']]);
  });
});

describe('guessMapping on real-world export headers', () => {
  it('maps Chrome/Edge password export headers', () => {
    const mapping = guessMapping(['name', 'url', 'username', 'password', 'note']);
    expect(mapping).toEqual({ 0: 'Title', 1: 'URL', 2: 'UserName', 3: 'Password', 4: 'Notes' });
  });

  it('maps Bitwarden export headers (login_uri must not become the username)', () => {
    const header = [
      'folder',
      'favorite',
      'type',
      'name',
      'notes',
      'fields',
      'reprompt',
      'login_uri',
      'login_username',
      'login_password',
      'login_totp'
    ];
    const mapping = guessMapping(header);
    expect(mapping[3]).toBe('Title');
    expect(mapping[4]).toBe('Notes');
    expect(mapping[7]).toBe('URL');
    expect(mapping[8]).toBe('UserName');
    expect(mapping[9]).toBe('Password');
    expect(mapping[0]).toBeUndefined(); // folder
    expect(mapping[2]).toBeUndefined(); // type
  });

  it('maps LastPass export headers', () => {
    const mapping = guessMapping(['url', 'username', 'password', 'totp', 'extra', 'name', 'fav']);
    expect(mapping[0]).toBe('URL');
    expect(mapping[1]).toBe('UserName');
    expect(mapping[2]).toBe('Password');
    expect(mapping[5]).toBe('Title');
  });

  it('assigns each standard field only once (first matching column wins)', () => {
    const mapping = guessMapping(['Username', 'User', 'Login']);
    expect(mapping).toEqual({ 0: 'UserName' });
  });

  it('ignores surrounding whitespace and is case-insensitive', () => {
    const mapping = guessMapping(['  PASSWORD  ', 'TiTlE']);
    expect(mapping).toEqual({ 0: 'Password', 1: 'Title' });
  });

  it('returns an empty mapping for unrecognized headers', () => {
    expect(guessMapping(['foo', 'bar'])).toEqual({});
  });
});

describe('rowsToEntries', () => {
  const rows = [
    ['name', 'password', 'url'],
    ['GitHub', 's3cret', 'https://github.com'],
    ['Bank', 'hunter2', 'https://bank.example']
  ];
  const mapping = { 0: 'Title', 1: 'Password', 2: 'URL' };

  it('skips the header row when hasHeader is true', () => {
    const entries = rowsToEntries(rows, mapping, true);
    expect(entries).toHaveLength(2);
    expect(entries[0].fields).toEqual([
      { name: 'Title', value: 'GitHub', protected: false },
      { name: 'Password', value: 's3cret', protected: true },
      { name: 'URL', value: 'https://github.com', protected: false }
    ]);
  });

  it('treats every row as data when hasHeader is false', () => {
    const entries = rowsToEntries(rows, mapping, false);
    expect(entries).toHaveLength(3);
    expect(entries[0].fields[0]).toEqual({ name: 'Title', value: 'name', protected: false });
  });

  it('fills missing cells with empty strings for short rows', () => {
    const entries = rowsToEntries([['OnlyTitle']], mapping, false);
    expect(entries[0].fields).toEqual([
      { name: 'Title', value: 'OnlyTitle', protected: false },
      { name: 'Password', value: '', protected: true },
      { name: 'URL', value: '', protected: false }
    ]);
  });

  it('marks only the Password field as protected, including custom names', () => {
    const entries = rowsToEntries([['a', 'b']], { 0: 'PIN', 1: 'Password' }, false);
    expect(entries[0].fields).toEqual([
      { name: 'PIN', value: 'a', protected: false },
      { name: 'Password', value: 'b', protected: true }
    ]);
  });

  it('skips columns mapped to an empty target name', () => {
    const entries = rowsToEntries([['x', 'y']], { 0: '', 1: 'Title' }, false);
    expect(entries[0].fields).toEqual([{ name: 'Title', value: 'y', protected: false }]);
  });
});
