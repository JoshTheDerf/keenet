import { describe, it, expect } from 'vitest';
import { exportToHtml } from './kdbx-to-html';
import type { EntryVm } from '@/types';

function entry(over: Partial<EntryVm>): EntryVm {
  return {
    id: 'e1',
    fileId: 'f1',
    groupId: 'g1',
    title: 'Entry',
    username: '',
    password: '',
    passwordProtected: false,
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
    ...over
  };
}

const GENERATED_AT = Date.UTC(2026, 0, 2, 3, 4, 5);

describe('exportToHtml', () => {
  it('escapes script tags in every entry-controlled field', () => {
    const xss = '<script>alert(1)</script>';
    const html = exportToHtml('vault', [
      entry({
        title: xss,
        username: xss,
        password: xss,
        notes: xss,
        tags: [xss],
        groupPath: ['root', xss],
        fields: [{ name: xss, value: xss, protected: false }]
      })
    ], GENERATED_AT);

    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes quotes and ampersands so attribute breakout is impossible', () => {
    const html = exportToHtml('vault', [
      entry({
        url: 'https://x.example/?a=1&b=2"onmouseover="alert(1)',
        title: 'Tom & "Jerry"'
      })
    ], GENERATED_AT);

    expect(html).toContain('Tom &amp; &quot;Jerry&quot;');
    // the raw double quote from the URL must never appear unescaped in the href
    expect(html).toContain('href="https://x.example/?a=1&amp;b=2&quot;onmouseover=&quot;alert(1)"');
    expect(html).not.toContain('"onmouseover="');
  });

  it('does not linkify javascript: (or other non-http) URLs', () => {
    const html = exportToHtml('vault', [entry({ url: 'javascript:alert(document.title)' })], GENERATED_AT);
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toMatch(/<a\s[^>]*javascript:/i);
    // the URL is still visible as inert text
    expect(html).toContain('javascript:alert(document.title)');
  });

  it('linkifies http(s) URLs with noopener', () => {
    const html = exportToHtml('vault', [entry({ url: 'https://example.com/login' })], GENERATED_AT);
    expect(html).toContain(
      '<a href="https://example.com/login" target="_blank" rel="noopener noreferrer">https://example.com/login</a>'
    );
  });

  it('escapes the file name used in title and heading', () => {
    const html = exportToHtml('<img src=x onerror=alert(1)>.kdbx', [], GENERATED_AT);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;.kdbx');
  });

  it('includes all rows, fields and tags, and skips trashed entries', () => {
    const html = exportToHtml('vault', [
      entry({
        id: 'a',
        title: 'Bank',
        username: 'joe',
        password: 'hunter2',
        notes: 'note text',
        tags: ['work', 'money'],
        groupPath: ['Root', 'Finance'],
        fields: [{ name: 'PIN', value: '9999', protected: true }]
      }),
      entry({ id: 'b', title: 'Old', inTrash: true }),
      entry({ id: 'c', title: '' })
    ], GENERATED_AT);

    expect(html.match(/<tr>/g)).toHaveLength(3); // header row + 2 visible entries
    expect(html).toContain('2 entries');
    expect(html).toContain('Exported 2026-01-02 03:04:05');
    expect(html).not.toContain('Old');
    expect(html).toContain('(no title)'); // untitled placeholder
    expect(html).toContain('Bank');
    expect(html).toContain('hunter2');
    expect(html).toContain('<b>PIN:</b> 9999');
    expect(html).toContain('work, money');
    expect(html).toContain('Root / Finance');
    expect(html).toContain('note text');
  });
});
