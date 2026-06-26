import { forwardRef } from "react";
import { cn } from "~/lib/cn";
import { formatVNDateShort, type WeekdayCode } from "~/lib/dates";
import { formatVND } from "~/lib/format";

/** Compact "HH:mm" → "8h" / "8h30" so a court time fits one line in the
 * matrix column header. */
function shortHM(hm: string): string {
  const [h, m] = hm.split(":");
  const hh = String(parseInt(h, 10));
  return m === "00" ? `${hh}h` : `${hh}h${m}`;
}

export interface MatrixCell {
  /** null = didn't vote */
  status: "thang" | "vang_lai" | "cho_pass" | "da_pass" | "hoan_tien" | null;
}

export interface MatrixRow {
  user: { id: string; name: string; gender: "nam" | "nu" };
  cells: MatrixCell[];
  totalSlots: number;
  totalFee: number;
}

export interface MatrixSession {
  id: string;
  date: string;
  weekday: WeekdayCode;
  voteCount: number;
  totalHours: number;
  courts: Array<{ id?: string; courtCode: string; startTime: string; endTime: string }>;
}

interface Props {
  year: number;
  month: number;
  sessions: MatrixSession[];
  rows: MatrixRow[];
  grandTotal: number;
  highlightUserId?: string;
  /** When the month is in voting state, courts haven't been allocated yet —
   * suppress the "— chưa đủ —" warning that would otherwise show on every cell. */
  monthStatus?: "draft" | "voting" | "locked" | "done";
  minPeoplePerSession: number;
  /** Users who have self-marked "đã chuyển tiền tháng" — drives the ✓ glyph
   *  on each row's Thu cell and the footer paid total. */
  paidUserIds?: ReadonlySet<string>;
  /** Sum of `totalFee` for users in `paidUserIds`. Pre-computed so the matrix
   *  stays a presentation component (no aggregation logic here). */
  paidTotal?: number;
}

// Matrix only shows attending seats (thang + vang_lai). Both are visually
// identical here: this view answers "did this person play?" not "what was
// their billing tier" — that lives in the total column.
function attendedGlyph(status: MatrixCell["status"]): string {
  return status === "thang" || status === "vang_lai" ? "✓" : "";
}

export const MonthMatrix = forwardRef<HTMLDivElement, Props>(function MonthMatrix(
  {
    sessions,
    rows,
    grandTotal,
    highlightUserId,
    monthStatus,
    minPeoplePerSession,
    paidUserIds,
    paidTotal,
  },
  ref,
) {
  const showEmptyWarning = monthStatus === "locked" || monthStatus === "done";
  // "Đã thu" column is part of every done-month bill — even if no member has
  // self-marked paid yet, admin needs the empty column visible so they can
  // see at a glance who hasn't paid.
  const showPaidColumn = monthStatus === "done";
  const hasPaid = !!paidUserIds && paidUserIds.size > 0;
  return (
    <div ref={ref} className="overflow-x-auto">
      <table className="min-w-[800px] border-collapse text-xs">
        <thead>
          <tr>
            <th rowSpan={4} className="border border-hairline p-1 text-left">
              STT
            </th>
            <th rowSpan={4} className="border border-hairline p-1 text-center">
              Nữ
            </th>
            <th rowSpan={4} className="border border-hairline p-1 text-left">
              Tên
            </th>
            {sessions.map((s) => {
              const insufficient = s.voteCount < minPeoplePerSession;
              return (
                <th
                  key={s.id}
                  className="border border-hairline bg-[#FEF3C7] p-1 text-left align-top"
                >
                  {insufficient ? (
                    <div className="text-xs text-semantic-error">
                      Chưa đủ {minPeoplePerSession} vote
                    </div>
                  ) : s.courts.length === 0 && showEmptyWarning ? (
                    <div className="text-xs text-semantic-error">— chưa đủ —</div>
                  ) : (
                    s.courts.map((c, i) => (
                      <div key={i}>
                        <strong>{c.courtCode}</strong>: {shortHM(c.startTime)}-{shortHM(c.endTime)}
                      </div>
                    ))
                  )}
                </th>
              );
            })}
            <th rowSpan={4} className="border border-hairline bg-[#FFFBEB] p-1">
              Tổng slot
            </th>
            <th rowSpan={4} className="border border-hairline bg-[#FFFBEB] p-1">
              Thu
            </th>
            {showPaidColumn && (
              <th rowSpan={4} className="border border-hairline bg-[#ECFDF5] p-1 text-semantic-success">
                Đã chuyển
              </th>
            )}
          </tr>
          <tr>
            {sessions.map((s) => (
              <th
                key={s.id + "-hr"}
                className="border border-hairline bg-[#FFFBEB] p-1 text-center"
              >
                {s.voteCount < minPeoplePerSession ? "—" : `${s.totalHours} tiếng`}
              </th>
            ))}
          </tr>
          <tr>
            {sessions.map((s) => (
              <th
                key={s.id + "-wd"}
                className="border border-hairline bg-[#7C2D12] p-1 text-center text-sm font-bold text-on-ink"
              >
                {s.weekday}
              </th>
            ))}
          </tr>
          <tr>
            {sessions.map((s) => (
              <th
                key={s.id + "-date"}
                className="border border-hairline bg-[#FEF3C7] p-1 text-center font-medium text-ink"
              >
                {formatVNDateShort(s.date)}
              </th>
            ))}
          </tr>
          <tr>
            <th colSpan={3} className="border border-hairline bg-[#FEF3C7] p-1 text-right">
              Số người · Tổng
            </th>
            {sessions.map((s) => (
              <th
                key={s.id + "-count"}
                className="border border-hairline bg-[#FEF3C7] p-1 text-center"
              >
                {s.voteCount}
              </th>
            ))}
            <th className="border border-hairline bg-[#FFFBEB] p-1 text-center font-semibold">
              {rows.reduce((sum, r) => sum + r.totalSlots, 0)}
            </th>
            <th className="border border-hairline bg-[#FFFBEB] p-1 text-right font-semibold">
              {formatVND(grandTotal)}
            </th>
            {showPaidColumn && (
              <th className="border border-hairline bg-[#ECFDF5] p-1 text-right font-semibold text-semantic-success">
                {formatVND(paidTotal ?? 0)}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => {
            const isMe = r.user.id === highlightUserId;
            const paid = paidUserIds?.has(r.user.id) ?? false;
            return (
              <tr
                key={r.user.id}
                className={cn(
                  "transition-colors",
                  isMe
                    ? "bg-accent-tint font-medium hover:bg-accent-tint/80"
                    : idx % 2
                      ? "bg-surface-strong/40 hover:bg-surface-strong"
                      : "hover:bg-surface-strong/60",
                )}
              >
                <td className="border border-hairline p-1">{idx + 1}</td>
                <td className="border border-hairline p-1 text-center">
                  {r.user.gender === "nu" ? "✓" : ""}
                </td>
                <td className="border border-hairline p-1">{r.user.name}</td>
                {r.cells.map((c, i) => (
                  <td
                    key={i}
                    className="border border-hairline p-1 text-center text-accent-deep font-medium"
                  >
                    {attendedGlyph(c.status)}
                  </td>
                ))}
                <td className="border border-hairline p-1 text-center font-medium">
                  {r.totalSlots}
                </td>
                <td className="border border-hairline p-1 text-right">
                  {formatVND(r.totalFee)}
                </td>
                {showPaidColumn && (
                  <td className="border border-hairline p-1 text-center text-semantic-success">
                    {paid && (
                      <span className="font-semibold" aria-label="đã chuyển">
                        ✓
                      </span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {hasPaid && (
        <p className="mt-2 text-caption text-muted">
          <span className="font-semibold text-semantic-success">✓</span> là đã chuyển
        </p>
      )}
    </div>
  );
});
