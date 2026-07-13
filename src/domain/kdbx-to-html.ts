/**
 * Export a database to a self-contained, styled HTML report (mirrors KeeWeb's
 * "Export to HTML"). Includes all standard + custom fields, tags and group path.
 */
import type { EntryVm } from '@/types';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function entryRow(entry: EntryVm): string {
  const custom = entry.fields
    .map((f) => `<div><b>${esc(f.name)}:</b> ${esc(f.protected ? f.value : f.value)}</div>`)
    .join('');
  const tags = entry.tags.length ? `<div class="tags">${entry.tags.map(esc).join(', ')}</div>` : '';
  // Only linkify http(s) URLs; anything else (javascript:, data:, …) is
  // rendered as plain text so the export never contains a clickable payload.
  const url = entry.url
    ? /^https?:\/\//i.test(entry.url)
      ? `<a href="${esc(entry.url)}" target="_blank" rel="noopener noreferrer">${esc(entry.url)}</a>`
      : esc(entry.url)
    : '';
  return `<tr>
    <td class="title">${esc(entry.title || '(no title)')}</td>
    <td>${esc(entry.username)}</td>
    <td class="mono">${esc(entry.password)}</td>
    <td>${url}</td>
    <td class="notes">${esc(entry.notes)}${custom}${tags}</td>
    <td>${esc(entry.groupPath.join(' / '))}</td>
  </tr>`;
}

export function exportToHtml(fileName: string, entries: EntryVm[], generatedAt: number): string {
  const visible = entries.filter((e) => !e.inTrash);
  const rows = visible.map(entryRow).join('\n');
  const date = new Date(generatedAt).toISOString().slice(0, 19).replace('T', ' ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>KeeNet export — ${esc(fileName)}</title>
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 2rem; color: #1e293b; }
  h1 { font-size: 1.4rem; }
  .meta { color: #64748b; margin-bottom: 1.5rem; font-size: .85rem; }
  .warn { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; padding: .6rem .8rem; border-radius: .4rem; margin-bottom: 1rem; font-size: .85rem; }
  table { border-collapse: collapse; width: 100%; font-size: .85rem; }
  th, td { border: 1px solid #e2e8f0; padding: .4rem .6rem; text-align: left; vertical-align: top; }
  th { background: #f8fafc; }
  .title { font-weight: 600; }
  .mono { font-family: ui-monospace, monospace; }
  .notes { white-space: pre-wrap; max-width: 30rem; }
  .tags { color: #2563eb; margin-top: .3rem; }
</style>
</head>
<body>
  <h1>${esc(fileName)}</h1>
  <div class="meta">Exported ${esc(date)} · ${visible.length} entries</div>
  <div class="warn">⚠ This file contains passwords in plain text. Store it securely and delete it when done.</div>
  <table>
    <thead><tr><th>Title</th><th>User</th><th>Password</th><th>URL</th><th>Notes</th><th>Group</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body>
</html>`;
}
