/**
 * MoMo deep-link validation — accept any HTTPS link whose host ends with
 * `momo.vn` (e.g. `me.momo.vn`, `quy.momo.vn`). We intentionally don't
 * restrict the path: MoMo has changed deep-link URL shapes a few times and
 * the only thing we want to guard against is members pasting unrelated URLs.
 */
export function isValidMomoLink(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return url.hostname === "momo.vn" || url.hostname.endsWith(".momo.vn");
}

export const MOMO_LINK_ERROR =
  "Link MoMo phải là URL https hợp lệ thuộc miền momo.vn (ví dụ: https://me.momo.vn/abc, https://quy.momo.vn/xyz).";
