// @vitest-environment jsdom
//
// DOMPurify officially supports jsdom; under happy-dom it mis-serializes
// (drops elements / hook-added attributes), so this file runs in jsdom while
// the rest of the suite stays on happy-dom.
import { describe, it, expect } from 'vitest';
import { renderMarkdown, looksLikeMarkdown } from './markdown';

describe('markdown rendering', () => {
  it('renders basic markdown', () => {
    expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>');
    expect(renderMarkdown('# hi')).toContain('<h1>hi</h1>');
  });

  it('opens links in a new tab with noopener', () => {
    const html = renderMarkdown('[k](https://k.io)');
    expect(html).toContain('href="https://k.io"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('strips scripts, styles and inline handlers', () => {
    const html = renderMarkdown('<script>alert(1)</script><style>*{}</style><img src="https://x/y.png" onerror="alert(1)">');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<style');
    expect(html).not.toContain('onerror');
  });

  it('drops javascript: and data: URLs', () => {
    const html = renderMarkdown('[x](javascript:alert(1)) [y](data:text/html,<script>alert(1)</script>)');
    expect(html.toLowerCase()).not.toMatch(/href\s*=\s*["']?\s*javascript:/);
    expect(html.toLowerCase()).not.toMatch(/href\s*=\s*["']?\s*data:/);
  });

  it('is not bypassable by entity-obfuscated javascript: URLs', () => {
    const html = renderMarkdown('<a href="jav&#x61;script:alert(1)">x</a>');
    expect(html.toLowerCase()).not.toContain('javascript:');
  });

  it('is not bypassable by nested/malformed tags', () => {
    const html = renderMarkdown('<scr<script>ipt>alert(1)</scr</script>ipt>');
    expect(html).not.toContain('<script');
  });

  it('drops svg/math vectors', () => {
    const html = renderMarkdown('<svg><animate onbegin="alert(1)"/></svg><math><mi xlink:href="javascript:alert(1)">x</mi></math>');
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<math');
    expect(html.toLowerCase()).not.toContain('javascript:');
  });

  it('drops data: image sources', () => {
    const html = renderMarkdown('![x](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)');
    expect(html.toLowerCase()).not.toContain('data:image');
  });

  it('drops non-http(s) custom scheme hrefs', () => {
    const html = renderMarkdown('<a href="vbscript:msgbox(1)">x</a><a href="file:///etc/passwd">y</a>');
    expect(html.toLowerCase()).not.toContain('vbscript:');
    expect(html.toLowerCase()).not.toContain('file:');
  });

  it('keeps GFM tables and task lists', () => {
    expect(renderMarkdown('| a |\n| - |\n| b |')).toContain('<table>');
    expect(renderMarkdown('- [x] done')).toContain('type="checkbox"');
  });

  it('returns empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('');
  });
});

describe('looksLikeMarkdown', () => {
  it('detects markdown-ish text', () => {
    expect(looksLikeMarkdown('**bold**')).toBe(true);
    expect(looksLikeMarkdown('# heading')).toBe(true);
    expect(looksLikeMarkdown('plain text')).toBe(false);
  });
});
