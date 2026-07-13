/**
 * Password audit — entropy estimate, PIN detection, weak / duplicate / reused /
 * old-password findings across a set of entries. HIBP lives in `hibp.ts`.
 */
import type { EntryVm } from '@/types';

export type IssueKind = 'weak' | 'duplicate' | 'pwned' | 'old';

export interface AuditIssue {
  entryId: string;
  fileId: string;
  kind: IssueKind;
  detail: string;
}

const AGE_LIMIT_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

/** Approximate Shannon entropy (bits) from character-class alphabet sizing. */
export function passwordEntropy(password: string): number {
  if (!password) return 0;
  let alphabet = 0;
  if (/[a-z]/.test(password)) alphabet += 26;
  if (/[A-Z]/.test(password)) alphabet += 26;
  if (/[0-9]/.test(password)) alphabet += 10;
  if (/[^a-zA-Z0-9]/.test(password)) alphabet += 33;
  if (alphabet === 0) return 0;
  return Math.round(password.length * Math.log2(alphabet));
}

export function isPin(password: string): boolean {
  return /^\d{3,8}$/.test(password);
}

export interface AuditOptions {
  entropyThreshold?: number; // bits below which a password is "weak"
  excludePins?: boolean;
  checkAge?: boolean;
}

/**
 * Run the offline audit (no network) over the given entries. Returns issues
 * for weak passwords, duplicates (same password used by >1 entry), and old
 * passwords. Trashed entries are skipped.
 */
export function auditEntries(entries: EntryVm[], opts: AuditOptions = {}): AuditIssue[] {
  const threshold = opts.entropyThreshold ?? 60;
  const issues: AuditIssue[] = [];
  const byPassword = new Map<string, EntryVm[]>();

  for (const entry of entries) {
    if (entry.inTrash || !entry.password) continue;

    // Weak
    if (!(opts.excludePins && isPin(entry.password))) {
      const bits = passwordEntropy(entry.password);
      if (bits < threshold) {
        issues.push({
          entryId: entry.id,
          fileId: entry.fileId,
          kind: 'weak',
          detail: `Low entropy (~${bits} bits)`
        });
      }
    }

    // Old
    if (opts.checkAge && entry.updated && Date.now() - entry.updated > AGE_LIMIT_MS) {
      const years = ((Date.now() - entry.updated) / (365 * 24 * 60 * 60 * 1000)).toFixed(1);
      issues.push({
        entryId: entry.id,
        fileId: entry.fileId,
        kind: 'old',
        detail: `Not changed in ${years} years`
      });
    }

    const list = byPassword.get(entry.password) ?? [];
    list.push(entry);
    byPassword.set(entry.password, list);
  }

  // Duplicates / reuse
  for (const [, list] of byPassword) {
    if (list.length > 1) {
      for (const entry of list) {
        issues.push({
          entryId: entry.id,
          fileId: entry.fileId,
          kind: 'duplicate',
          detail: `Reused by ${list.length} entries`
        });
      }
    }
  }

  return issues;
}
