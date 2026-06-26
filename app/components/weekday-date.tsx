import { formatVNDateShort, type WeekdayCode } from "~/lib/dates";

/**
 * Canonical weekday + date pair, used everywhere a session is identified by
 * its day. Style matches the trang-chu session card so /lich, admin, dialogs,
 * banners, and history sheets all render the same way.
 *
 * Inherits font size from the parent so the same component fits any context
 * (large card title, small badge inline, etc).
 */
export function WeekdayDate({
  weekday,
  date,
  className,
}: {
  weekday: WeekdayCode | string;
  date: string;
  className?: string;
}) {
  // Color + font-size are inherited from the parent so the component works in
  // any context (large card title, small badge, themed pill).
  return (
    <span className={"inline-flex items-baseline gap-1.5" + (className ? " " + className : "")}>
      <span className="font-semibold">{weekday}</span>
      <span>{formatVNDateShort(date)}</span>
    </span>
  );
}
