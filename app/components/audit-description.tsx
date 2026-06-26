import { Fragment } from "react";
import { describeEvent, type DescribableEvent } from "~/lib/audit-format";

/**
 * Renders the Vietnamese audit sentence with member names bolded. Reads
 * names from the event payload (actor/subject + auto-match meta) and wraps
 * each occurrence with `<strong>`. Falls back to plain text when no names
 * apply (system-only events like "Khoá đăng ký pass / vãng lai").
 */
export function AuditDescription({ event }: { event: DescribableEvent }) {
  const text = describeEvent(event);
  const names = collectNames(event);
  if (names.length === 0) return <>{text}</>;
  // Sort longest-first so a shorter name doesn't gobble characters from a
  // longer one ("Anh" inside "Anh Tuấn").
  const uniq = Array.from(new Set(names)).sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(${uniq.map(escapeRegex).join("|")})`, "g");
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, i) =>
        uniq.includes(part) ? (
          <strong key={i}>{part}</strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

function collectNames(e: DescribableEvent): string[] {
  const out: string[] = [];
  if (e.actorName) out.push(e.actorName);
  if (e.subjectName) out.push(e.subjectName);
  const m = e.meta;
  if (m) {
    if (typeof m.payerName === "string") out.push(m.payerName);
    if (typeof m.passSlotterName === "string") out.push(m.passSlotterName);
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
