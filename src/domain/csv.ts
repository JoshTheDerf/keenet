/**
 * CSV import. RFC-4180-ish parser (quoted fields, embedded commas/newlines,
 * "" escaping) plus column→field mapping used to create entries.
 */

export type CsvRow = string[];

/** Parse CSV text into rows of string cells. */
export function parseCsv(text: string): CsvRow[] {
  // Strip a UTF-8 BOM (Excel and several exporters emit one) so it doesn't
  // end up glued to the first header/field.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: CsvRow[] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      pushField();
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      pushRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // trailing field/row (ignore a pure trailing newline)
  if (field.length > 0 || row.length > 0) pushRow();
  return rows.filter((r) => r.some((c) => c !== ''));
}

export type StdField = 'Title' | 'UserName' | 'Password' | 'URL' | 'Notes';

/** Map of column index → target field name (std name or custom field name). */
export type CsvMapping = Record<number, string>;

const HEADER_GUESS: { field: string; re: RegExp }[] = [
  { field: 'Title', re: /^(title|name|account|entry)/i },
  { field: 'UserName', re: /^(user\s*name|user|login|email|e-mail|account)/i },
  { field: 'Password', re: /^(password|pass|pwd)/i },
  { field: 'URL', re: /^(url|website|web\s*site|link|uri|address)/i },
  { field: 'Notes', re: /^(notes?|comment|description|memo)/i }
];

/** Guess a column→field mapping from a header row. */
export function guessMapping(header: CsvRow): CsvMapping {
  const mapping: CsvMapping = {};
  const used = new Set<string>();
  header.forEach((col, idx) => {
    // Bitwarden prefixes its columns (login_uri, login_username, login_password);
    // strip the prefix so login_uri doesn't hit the generic "login" → UserName rule.
    const name = col.trim().replace(/^login_/i, '');
    for (const { field, re } of HEADER_GUESS) {
      if (!used.has(field) && re.test(name)) {
        mapping[idx] = field;
        used.add(field);
        return;
      }
    }
  });
  return mapping;
}

export interface CsvEntryData {
  fields: { name: string; value: string; protected: boolean }[];
}

/** Turn data rows into per-entry field lists using a mapping. */
export function rowsToEntries(rows: CsvRow[], mapping: CsvMapping, hasHeader: boolean): CsvEntryData[] {
  const dataRows = hasHeader ? rows.slice(1) : rows;
  return dataRows.map((row) => {
    const fields: CsvEntryData['fields'] = [];
    for (const [idxStr, name] of Object.entries(mapping)) {
      if (!name) continue;
      const value = row[Number(idxStr)] ?? '';
      fields.push({ name, value, protected: name === 'Password' });
    }
    return { fields };
  });
}
