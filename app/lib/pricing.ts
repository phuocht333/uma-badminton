/**
 * Pure pricing rules for the two external transfers the app tracks.
 *
 * Two questions live here. Each was duplicated inline across multiple
 * read paths (payment-summary, trang-chu loader, home-summary, email); this
 * module centralises them so a future tier change touches one file.
 *
 * - `priceForPassClaim` — what the claimer transfers to the original passer
 *   for a single non-auto-match pass. Auto-match cross-gender splits live
 *   in `auto-match.server.ts/computeAutoMatchPayment` because they involve
 *   the quỹ as a third party; this helper is only for the simple direct
 *   transfer case.
 * - `priceForVangLaiQuy` — what an admin-approved vãng lai voter owes the
 *   quỹ chung.
 *
 * Both are pure (no D1, no env) — caller supplies the price table from
 * `getPrices(d1)`. Lives in `app/lib/` (no `.server.ts` suffix) because the
 * client-side share dialog uses it for instant feedback before submit.
 */
import type { PriceTable } from "./config.server";

export type Gender = "nam" | "nu";
export type PassTier = "thang" | "vang_lai";

/**
 * Claimer's transfer in a direct (non auto-match) pass. The tier the original
 * voter paid in fully determines what the claimer pays back — claimer always
 * settles at the OWNER's gender × tier so the owner's bill is reimbursed.
 */
export function priceForPassClaim(
  args: { originalVoteStatus: PassTier },
  ownerGender: Gender,
  prices: PriceTable,
): number {
  const tier = args.originalVoteStatus === "vang_lai" ? "vang_lai" : "thang";
  return prices[tier][ownerGender];
}

/** What an admin-approved vãng lai voter owes the quỹ chung. */
export function priceForVangLaiQuy(gender: Gender, prices: PriceTable): number {
  return prices.vang_lai[gender];
}

/**
 * Amount the quỹ owes back to a member when admin approves a pass-slot refund.
 * They paid the monthly thang fee that included this session; without a claimer
 * the session goes uncharged, so the quỹ refunds the per-session thang value.
 */
export function priceForPassRefund(gender: Gender, prices: PriceTable): number {
  return prices.thang[gender];
}
