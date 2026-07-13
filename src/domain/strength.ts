/**
 * Password strength estimation.
 *
 * Uses zxcvbn (lazy-loaded so it doesn't bloat the initial bundle) and maps its
 * 0–4 score onto KeeWeb-style labels + a normalized 0–1 value for the meter.
 */

export type StrengthLevel = 0 | 1 | 2 | 3 | 4;

export interface PasswordStrength {
  level: StrengthLevel;
  label: string;
  /** Normalized bar fill, 0..1 */
  value: number;
  /** Estimated guesses (log10) if available. */
  guessesLog10?: number;
  color: 'error' | 'warning' | 'primary' | 'success';
}

const LABELS: Record<StrengthLevel, string> = {
  0: 'Very weak',
  1: 'Weak',
  2: 'Fair',
  3: 'Good',
  4: 'Strong'
};

const COLORS: Record<StrengthLevel, PasswordStrength['color']> = {
  0: 'error',
  1: 'error',
  2: 'warning',
  3: 'primary',
  4: 'success'
};

type ZxcvbnFn = (password: string, userInputs?: string[]) => {
  score: number;
  guesses_log10?: number;
};

let zxcvbnPromise: Promise<ZxcvbnFn> | null = null;

async function loadZxcvbn(): Promise<ZxcvbnFn> {
  if (!zxcvbnPromise) {
    zxcvbnPromise = import('zxcvbn').then((m) => (m.default ?? m) as unknown as ZxcvbnFn);
  }
  return zxcvbnPromise;
}

/** Synchronous heuristic used before zxcvbn loads (or in tests). */
export function quickStrength(password: string): PasswordStrength {
  if (!password) return toStrength(0);
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((r) => r.test(password)).length;
  if (classes >= 3) score++;
  if (classes >= 4 && password.length >= 16) score++;
  return toStrength(Math.min(score, 4) as StrengthLevel);
}

function toStrength(level: StrengthLevel, guessesLog10?: number): PasswordStrength {
  return {
    level,
    label: LABELS[level],
    value: level / 4,
    guessesLog10,
    color: COLORS[level]
  };
}

export async function estimateStrength(
  password: string,
  userInputs: string[] = []
): Promise<PasswordStrength> {
  if (!password) return toStrength(0);
  try {
    const zxcvbn = await loadZxcvbn();
    const res = zxcvbn(password, userInputs);
    const level = Math.max(0, Math.min(4, res.score)) as StrengthLevel;
    return toStrength(level, res.guesses_log10);
  } catch {
    return quickStrength(password);
  }
}
