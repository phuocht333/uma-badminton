# Pass-slot lifecycle — test cases

✅ Integration test harness wired up in `app/lib/__tests__/harness.ts`
(in-memory SQLite via `better-sqlite3` + D1 shim). Lifecycle tests live in
`app/lib/__tests__/pass-slot.integration.test.ts`,
`extra-slot.integration.test.ts`, `auto-match.integration.test.ts`, and
`end-to-end.integration.test.ts`. Cross-table data integrity is enforced via
`invariants.ts::assertInvariants` after every successful path.

This file is now the design-intent spec; the test files are the executable
truth. Update both together when adding lifecycle behaviour.

## requestPass

- ✅ rejects when caller is not the vote's owner (`status: 403`).
- ✅ rejects when vote is not `thang` or `vang_lai` (e.g. already `cho_pass`,
  `da_pass`, or `hoan_tien`).
- ✅ rejects when the month is `voting` or `locked` (must be `done`).
- ✅ still allowed after the old cutoff-24h mark (no registration deadline).
- ✅ rejects when an unclaimed pass already exists for the vote.
- ✅ rejects when the caller has a pending vãng lai on the same session
  (cannot be both passer and vãng lai — would auto-match to self).
- ✅ flips vote status to `cho_pass` and inserts a new `pass_requests` row
  with `originalVoteStatus` matching the prior vote status (thang OR vang_lai).
- ✅ writes a `pass_requested` audit log.
- ✅ auto-assigns to the earliest pending vãng lai on the same session.
- ✅ does NOT auto-assign when there is no pending vãng lai.
- ✅ does NOT auto-assign to the passer themselves.
- ✅ upserts a new `votes` row for the auto-assignee with `status: "thang"`
  and `originalVoterId` set to the original voter.
- ✅ marks the auto-assigned vãng lai's `extra_slot_request.approvedAt` and
  leaves `approvedByUserId` NULL (system marker, not admin).

## cancelPass

- ✅ rejects when caller is not the vote's owner.
- ✅ rejects when no open `pass_request` exists (already claimed/refunded/rejected).
- ✅ still allowed after the old cutoff-24h mark (no registration deadline).
- ✅ deletes the `pass_request` row and writes a `pass_cancelled` audit log.
- ✅ restores vote to `originalVoteStatus` when vote is still `cho_pass`.
- ✅ orphan cleanup: if vote is no longer `cho_pass` (was overwritten via
  another path), still deletes the row but does NOT alter the vote status.

## claimAndConfirm

- ✅ rejects when caller is the passer themselves.
- ✅ rejects when caller already has a `thang` / `vang_lai` vote on the session.
- ✅ allows claim when caller has a prior `hoan_tien` or `da_pass` vote
  (upsert overwrites to `thang`).
- ✅ rejects on non-`done` months.
- ✅ still allowed after the old cutoff-24h mark (no registration deadline).
- ✅ rejects when the `pass_request` is already admin-rejected.
- ✅ flips original vote to `da_pass`, upserts claimer's vote to `thang`,
  sets `pass_request.claimedAt + confirmedAt`.
- ✅ cancels caller's pending `extra_slot_request` on the same session.
- ✅ writes a `pass_confirmed` audit log with payment-meta breakdown.
- ✅ multi-hop chain preserves head `originalVoterId`.

## confirmPass (auto-assigned payment confirm)

- ✅ rejects when caller is not the `claimedByUserId`.
- ✅ idempotent: second call on already-confirmed row returns `ok: true`.
- ✅ stamps `confirmedAt`, runs `transferSeatToClaimer` (idempotent),
  cancels claimer's pending vãng lai, writes `pass_confirmed` audit.

## approvePassRefund (admin)

- ✅ rejects when the `pass_request` is claimed or rejected.
- ✅ rejects when the vote is no longer `cho_pass`.
- ✅ vote → `hoan_tien`; `pass_request.confirmedAt` set; `refund_payments`
  row inserted with snapshot amount; `refund_issued` audit.

## rejectPassRequest (admin)

- ✅ rejects when the `pass_request` is claimed or rejected.
- ✅ vote reverts to `originalVoteStatus`; `pass_request.rejectedAt +
  rejectedByUserId` set; `pass_rejected` audit.

## registerVangLai

- ✅ rejects when session not found or month is not `done`.
- ✅ still allowed after the old cutoff-24h mark (no registration deadline).
- ✅ rejects when caller already has `thang` / `vang_lai` vote on the session.
- ✅ rejects when caller has `cho_pass` vote (mirror of requestPass guard).
- ✅ rejects when caller already has a pending `extra_slot_request`.
- ✅ rejects when caller has an already-approved request.
- ✅ resets a previously cancelled / rejected row (reuse, no duplicate insert).
- ✅ first-time: inserts row + `vang_lai_requested` audit.
- ✅ triggers `tryAutoMatch` after insert.

## cancelExtraSlotRequest

- ✅ false when caller is not the owner.
- ✅ false when already approved / cancelled / rejected.
- ✅ still allowed after the old cutoff-24h mark (owner keeps control).
- ✅ stamps `cancelledAt` + `vang_lai_cancelled` audit.

## approveSingleRequest (admin)

- ✅ false when not found / already approved / already cancelled.
- ✅ inserts `vang_lai` vote when user has no prior vote.
- ✅ overwrites prior vote (any status) to `vang_lai`.
- ✅ **CRITICAL**: if prior vote is `cho_pass` with an open `pass_request`,
  deletes the orphan `pass_request` before flipping vote to `vang_lai`.
  (Regression guard for the orphan bug we fixed.)
- ✅ `vang_lai_approved` audit fired with `subjectUserId` = the member.

## approvePendingForSession (admin)

- ✅ returns 0 when nothing pending.
- ✅ approves all pending in FIFO order (oldest `createdAt` first).
- ✅ skips already-approved and cancelled rows.

## rejectSingleExtraSlotRequest (admin)

- ✅ `ok: false` when not found or already terminal.
- ✅ stamps `rejectedAt + rejectedByUserId` + `vang_lai_rejected` audit.

## refundPendingPassRequests (admin — court removed)

- ✅ returns 0 when no open `pass_request` on the session.
- ✅ ignores `pass_request` rows on other sessions.
- ✅ flips cho_pass votes → `hoan_tien`; stamps `pass_request.confirmedAt`
  (so the row is terminal); `refund_issued` audit with
  `meta.reason: "court_removed"`.
- ✅ skips already-claimed `pass_request` rows.

## tryAutoMatch

- ✅ null when no pending vãng lai.
- ✅ null when no open pass_request.
- ✅ still matches after the old cutoff-24h mark.
- ✅ skips self-match: only same-user pass-slot exists → null.
- ✅ FIFO on vãng lai side (anchors on oldest pending vãng lai).
- ✅ skips same-user pass-slot when picking a counterpart for a vãng lai
  belonging to that user (walks past it to the next eligible pass).
- ✅ atomic claim: sets `claimedAt` only — `confirmedAt` stays null so the
  homepage payment banner appears.
- ✅ approves the vãng lai's `extra_slot_request` with `approvedByUserId = NULL`
  (system marker, not admin).
- ✅ computes cross-gender payment breakdown via current prices.

## transferSeatToClaimer

- ✅ original vote → `da_pass`.
- ✅ claimer with no existing vote → insert `thang` with `originalVoterId =
  original.userId`.
- ✅ claimer with existing vote (any status) → overwrite to `thang`.
- ✅ multi-hop: preserves head `originalVoterId` when transferring a chained
  vote.
- ✅ idempotent: calling twice yields the same `newVoteId`, no duplicate row.

## Never-expiring states (B34 — no cutoff)

There is no deadline anywhere, so these states persist until a human acts.
Asserted in `pass-slot.integration.test.ts` §4.7 and
`extra-slot.integration.test.ts`:

- ✅ unclaimed pass on a session that already happened keeps `cho_pass`, and the
  `pass_request` stays open (claimedAt / rejectedAt / confirmedAt all null).
- ✅ that voter is still billed at the **thang** rate (`computeMemberTotals`) —
  passing a slot nobody takes does not remove you from the bill.
- ✅ admin duyệt hoàn tiền → `hoan_tien`, drops off the bill.
- ✅ admin từ chối → back to `originalVoteStatus`, stays on the bill (B29).
- ✅ pending vãng lai on a past session stays pending and creates **no** vote,
  so it never reaches the bill.
- ✅ admin can still duyệt (→ `vang_lai` vote) or từ chối (→ no vote) it after
  the session date.

## End-to-end / cross-flow

- ✅ Full lifecycle: A thang → A requestPass → B registerVangLai → auto-match
  → B confirmPass. Audit trail in order: `pass_requested`, `vang_lai_requested`,
  `auto_matched`, `pass_confirmed`.
- ✅ A passes then cancels before any claim → vote restores, no leftover row.
- ✅ B cancels vãng lai before A's pass → A can still pass later.
- ✅ Admin approves vãng lai for user with `cho_pass` vote — pass_request
  cleaned, no orphan.
- ✅ Legacy orphan recoverable via `cancelPass`.
- ✅ Multi-hop A→B→C through real entry points; seat-attribution returns just C.
- ✅ Court removed: all open pass_requests on the session resolved into
  `hoan_tien` with terminal `confirmedAt`.
- ✅ Dual-queue prevention: both `requestPass` and `registerVangLai` block
  the same user from sitting in both pools simultaneously.

## Cross-table invariants (asserted after every successful path)

- **I1**: per-session vote uniqueness (DB unique index — documented as defence).
- **I2**: every still-open `pass_request` (claimedAt / rejectedAt / confirmedAt
  all NULL) references a vote currently in `cho_pass`.
- **I3**: claimed `pass_request` ⇒ original vote is `da_pass`.
- **I4**: approved `extra_slot_request` ⇒ user has a vote row on the session.
