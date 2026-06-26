/**
 * Pure formatters — safe in both server and client bundles.
 */

export function formatVND(amount: number): string {
  return new Intl.NumberFormat("vi-VN").format(amount) + "đ";
}

export function formatDateVN(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${d.getUTCFullYear()}`;
}

export function formatDateString(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split("-");
  return `${d}-${m}-${y}`;
}
