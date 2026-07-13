// Parsing edge cases beyond the happy paths in ported.test.ts (default
// sequence, {S:...}/{TOTP}/{DELAY} and basic sequenceToText are covered there).
import { describe, it, expect } from 'vitest';
import { parseSequence, sequenceToText, type AutoTypeContext } from './auto-type';

const ctx: AutoTypeContext = {
  title: 'My Title',
  username: 'alice',
  password: 'p@ss',
  url: 'https://example.com',
  notes: 'some notes',
  fields: { 'Custom Field': 'custom-value' }
};

describe('parseSequence', () => {
  it('resolves all standard placeholders case-insensitively', () => {
    expect(parseSequence('{username}{Url}{TITLE}{notes}', ctx)).toEqual([
      { type: 'text', text: 'alice' },
      { type: 'text', text: 'https://example.com' },
      { type: 'text', text: 'My Title' },
      { type: 'text', text: 'some notes' }
    ]);
  });

  it('keeps literal text between and around directives as separate ops', () => {
    expect(parseSequence('user: {USERNAME}!', ctx)).toEqual([
      { type: 'text', text: 'user: ' },
      { type: 'text', text: 'alice' },
      { type: 'text', text: '!' }
    ]);
  });

  it('parses consecutive key ops like {TAB}{ENTER}', () => {
    expect(parseSequence('{TAB}{ENTER}{ESC}{PGDN}', ctx)).toEqual([
      { type: 'key', key: 'TAB' },
      { type: 'key', key: 'ENTER' },
      { type: 'key', key: 'ESC' },
      { type: 'key', key: 'PGDN' }
    ]);
  });

  it('turns unknown directives into literal text instead of dropping them', () => {
    expect(parseSequence('{VKEY 13}{USERNAME}', ctx)).toEqual([
      { type: 'text', text: '{VKEY 13}' },
      { type: 'text', text: 'alice' }
    ]);
  });

  it('supports {DELAY n} and {DELAY=n}, rejecting malformed delays as literals', () => {
    expect(parseSequence('{DELAY 250}', ctx)).toEqual([{ type: 'delay', ms: 250 }]);
    expect(parseSequence('{DELAY=100}', ctx)).toEqual([{ type: 'delay', ms: 100 }]);
    expect(parseSequence('{DELAY abc}', ctx)).toEqual([{ type: 'text', text: '{DELAY abc}' }]);
  });

  it('resolves {S:...} custom fields, empty for missing ones', () => {
    expect(parseSequence('{S:Custom Field}', ctx)).toEqual([
      { type: 'text', text: 'custom-value' }
    ]);
    expect(parseSequence('{S:Nope}', ctx)).toEqual([{ type: 'text', text: '' }]);
  });

  it('resolves {TOTP} to empty text when the entry has no otp', () => {
    expect(parseSequence('{TOTP}', ctx)).toEqual([{ type: 'text', text: '' }]);
  });

  it('does not throw on malformed sequences', () => {
    // unterminated directive → literal tail
    expect(parseSequence('{USERNAME', ctx)).toEqual([{ type: 'text', text: '{USERNAME' }]);
    // empty braces → literal
    expect(parseSequence('{}', ctx)).toEqual([{ type: 'text', text: '{}' }]);
    // stray closing brace → literal
    expect(parseSequence('}a{TAB}', ctx)).toEqual([
      { type: 'text', text: '}a' },
      { type: 'key', key: 'TAB' }
    ]);
    // nested braces parse deterministically (inner token is unknown → literal)
    expect(parseSequence('{{USERNAME}}', ctx)).toEqual([
      { type: 'text', text: '{{USERNAME}}' }
    ]);
    expect(parseSequence('', ctx)).toEqual([]);
  });

  it('does not recursively expand placeholders coming from entry data', () => {
    const evil: AutoTypeContext = { ...ctx, username: '{PASSWORD}' };
    expect(parseSequence('{USERNAME}', evil)).toEqual([
      { type: 'text', text: '{PASSWORD}' }
    ]);
  });
});

describe('sequenceToText', () => {
  it('substitutes username/password and renders TAB as \\t', () => {
    expect(sequenceToText('{USERNAME}{TAB}{PASSWORD}', ctx)).toBe('alice\tp@ss');
  });

  it('drops non-TAB keys and delays', () => {
    expect(sequenceToText('{USERNAME}{ENTER}{DELAY 500}{PASSWORD}{ESC}', ctx)).toBe('alicep@ss');
  });

  it('keeps literal text and unknown directives verbatim', () => {
    expect(sequenceToText('pw={PASSWORD} {FOO}', ctx)).toBe('pw=p@ss {FOO}');
  });
});
