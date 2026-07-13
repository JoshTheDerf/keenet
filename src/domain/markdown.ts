/**
 * Notes markdown rendering. Uses `marked` for parsing and DOMPurify for
 * sanitization (a real HTML parser — regex sanitizers are bypassable via
 * entity obfuscation, nested tags, svg/math namespaces, data: URIs, etc.).
 * Links open in a new tab with `rel="noopener noreferrer"` and only http(s)
 * (and mailto:) URLs are allowed anywhere a URI can appear.
 */
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });

/** Only plain web links may survive sanitization (no javascript:, data:, blob:, file:, custom schemes). */
const SAFE_HREF = /^(?:https?:|mailto:)/i;
/** Embedded resources must come over the network — data:/blob: images can smuggle content. */
const SAFE_SRC = /^https?:/i;

const purifier = DOMPurify();

// Force safe link behavior and drop unsafe URL attributes. Runs after
// DOMPurify's own attribute sanitization, on real DOM nodes, so it cannot be
// bypassed with encoding tricks the way the old regex pass could. The explicit
// src check also closes DOMPurify's built-in allowance of data: URIs on <img>.
purifier.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    const href = node.getAttribute('href') ?? '';
    if (href && !SAFE_HREF.test(href.trim())) {
      node.removeAttribute('href');
    }
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
  if (node.hasAttribute('src')) {
    const src = node.getAttribute('src') ?? '';
    if (!SAFE_SRC.test(src.trim())) {
      node.removeAttribute('src');
    }
  }
});

const SANITIZE_OPTIONS = {
  // Conservative allowlist covering what marked (GFM) emits. No svg/math,
  // no forms, no media that could trigger network requests except images.
  ALLOWED_TAGS: [
    'a', 'p', 'br', 'hr', 'div', 'span',
    'b', 'strong', 'i', 'em', 'u', 's', 'del', 'ins', 'mark', 'sub', 'sup',
    'blockquote', 'pre', 'code', 'kbd',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'input',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
    'img'
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'title', 'alt', 'src', 'type', 'checked', 'disabled', 'align', 'start'],
  // `input` is only for GFM task-list checkboxes; everything arrives disabled
  // via marked, and no event handlers/styles survive sanitization anyway.
  ALLOW_DATA_ATTR: false,
  // DOMPurify applies this to EVERY attribute value, not just URLs, so it must
  // keep the default's "schemeless values pass" tail (else e.g. type="checkbox"
  // is stripped). Only the scheme allowlist is tightened: https/mailto instead
  // of ftp/tel/callto/sms/cid/xmpp/matrix. javascript:, data:, blob:, file: and
  // custom schemes never match. (data: on <img> has a DOMPurify built-in
  // exemption — closed by the src hook above.)
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i
};

export function renderMarkdown(text: string): string {
  if (!text) return '';
  const raw = marked.parse(text, { async: false }) as string;
  return purifier.sanitize(raw, SANITIZE_OPTIONS);
}

/** Whether the text has any markdown-ish syntax worth rendering. */
export function looksLikeMarkdown(text: string): boolean {
  return /[*_#`>[\]]|\n\s*[-*+]\s|\d+\.\s|\|/.test(text);
}
