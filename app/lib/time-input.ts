/**
 * Lenient HH:mm normaliser for admin court-time inputs.
 *
 * Accepted shapes (24h):
 *   "8"      → "08:00"
 *   "08"     → "08:00"
 *   "8:0"    → "08:00"
 *   "8:5"    → "08:05"
 *   "08:00"  → "08:00"
 *   "23:59"  → "23:59"
 *
 * Anything that doesn't parse passes through untouched — server-side pattern
 * `/^\d{2}:\d{2}$/` will reject it.
 */
export function normalizeHHMM(raw: string): string {
  const trimmed = raw.trim();
  const m = trimmed.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return trimmed;
  const h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  if (h > 23 || min > 59) return trimmed;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** onBlur handler — rewrites the input value in place. */
export function normalizeTimeBlur(e: React.FocusEvent<HTMLInputElement>): void {
  const next = normalizeHHMM(e.currentTarget.value);
  if (next !== e.currentTarget.value) {
    e.currentTarget.value = next;
  }
}
