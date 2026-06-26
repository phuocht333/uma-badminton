# Uma Badminton — Domain glossary

This file is the canonical vocabulary for the project. Code, commits,
discussions, and docs use these terms — drift = bugs. Add a term here the
first time you reach for it; if a concept earns a name in conversation, it
earns a row in this table.

Pair with `/Users/phuochuynh/Documents/personalStuff/uma-badminton/CLAUDE.md`
(project conventions + how to work in this repo).

## Core entities

| Term | Definition |
|---|---|
| **Member** | An authenticated user. Either an admin or a regular member. Identified by `users.id`. UI is Vietnamese only. |
| **Month** | A calendar month with a 3-state lifecycle. UI labels map onto the DB enum: `voting` → **"Đang mở vote"**, `locked` → **"Đã khoá"**, `done` → **"Đã đặt sân"**. Transitions: voting → locked (cron at `voteCloseAt` OR admin "Khoá vote ngay"); locked → voting (admin "Mở lại vote" — deletes courts + cancels pending); locked → done (admin "Chốt đã đặt sân" — one-way, snapshot taken, next month vote auto-opens). |
| **Play session** | One T7/CN within a month (`play_sessions` row). Has at most one set of `court_allocations`. |
| **Court allocation** | A booked court for a session (`courtCode`, `startTime`, `endTime`). Created at lock time or manually by admin. |
| **Vote** | A member's intent to play a session. Status enum: `thang`, `vang_lai`, `cho_pass`, `da_pass`, `hoan_tien`. The `votes` table is the source of truth for seat ownership — `pass_requests` is a workflow ledger only. |
| **Pass request** | A workflow ledger row tracking the lifecycle of a passed slot (open → claimed → confirmed). Does NOT decide seat ownership; that lives on `votes.status`. |
| **Extra slot request** | A member's pending request to be added as vãng lai when they haven't voted (admin-gated; never auto-approved instantly). |

## Vote status (the most overloaded enum)

| Status | Meaning | Member sees | Counts as attending? |
|---|---|---|---|
| `thang` | Has paid month-rate seat | "Đã vote tháng" | ✓ |
| `vang_lai` | Has paid walk-in-rate seat | "Vãng lai" | ✓ |
| `cho_pass` | Passing the slot, waiting for claim | "Chờ pass" | ✓ (still on bill until claimed) |
| `da_pass` | Passed away — claimer now owns the seat | "Đã pass" | ✗ |
| `hoan_tien` | Refunded — seat dropped, no charge | "Hoàn tiền" | ✗ |

**Seat-attribution rule** (lives in `app/lib/seat-attribution.ts`): walk the
votes table only. `thang`/`vang_lai`/`cho_pass` emit a seat; `da_pass` and
`hoan_tien` don't. `pass_requests` is NOT consulted for ownership. This makes
multi-hop chains (A → B → C) trivial — each claimer gets a fresh `thang`
vote, so the next requestPass works the same way.

## Pass-slot lifecycle (the trickiest flow)

The single home of state transitions is `app/lib/pass-slot.server.ts`.

1. **Open** — passer calls `requestPass(voteId)`. A `pass_requests` row is
   created with `claimedAt: null, confirmedAt: null`. The passer's vote
   flips to `cho_pass`.
2. **Auto-assign** — if there's a pending vãng lai on the same session,
   `autoAssignPassToWaitingVangLai` runs immediately. It atomically claims
   the pass for the earliest waiting member (FIFO), transfers the seat
   (their vote → `thang`, original passer → `da_pass`), and cancels their
   extra_slot_request. `confirmedAt` stays null.
3. **Manual claim** — if no auto-assign target, another member calls
   `claimAndConfirm(requestId)`. This is atomic: claim, confirm, transfer
   seat in one transaction.
4. **Payment confirm** — for auto-assigned passes only: the claimer pays the
   original passer externally then clicks "Đã thanh toán" on the homepage
   banner. `confirmPass(requestId)` stamps `confirmedAt`; the banner clears;
   audit log records `pass_confirmed`.

**Invariants** (centralised in `pass-slot.server.ts/assert*` helpers):
- Locked / done months reject all pass actions.
- A member cannot claim their own slot.
- A claimer cannot already hold an attending seat (`thang`/`vang_lai`) on
  the session.

**Multi-hop**: every hop produces a new `thang` vote for the claimer, so
B passing what they got from A works like any other pass. `originalVoterId`
is preserved through the chain (always references A).

## "Visible sessions" rule

For `locked`/`done` months, any session that never received a court
allocation didn't meet the minimum count and is hidden everywhere — matrix,
bill, home cards, admin views. Source of truth: `app/lib/sessions.ts`.

Voting / draft months show every session so members see what's on the table.

## Freeze-time matrix snapshot

When admin clicks "Chốt đã đặt sân" (locked → done), `freezeMonthAsBooked`
serialises the matrix (sessions + per-user rows + grand total) into
`months.lockedSnapshot`. From that point on:

- "Đã đặt sân" (`done`): `/lich` matrix + bill read the **snapshot**.
  Admin can still tweak courts via `/admin/sessions/<id>` or the CourtEditDialog
  on /lich — those changes only ripple to **live home cards** on trang-chu,
  never to the frozen bill.
- "Đã khoá" (`locked`): `/lich` matrix + bill compute **live**. Admin's
  edits show immediately on /lich while finalising. Members are still
  blocked from voting / pass / vãng lai in this state.

Reverse (`unlockMonthForVoting`) clears `lockedSnapshot` defensively (none
should exist, but safety).

Source of truth: `app/lib/month-snapshot.server.ts`.

## Action matrix by month status

| Action | Đang mở vote | Đã khoá | Đã đặt sân |
|---|---|---|---|
| Vote thêm/bớt | ✓ | ✗ | ✗ |
| Pass slot (cutoff) | ✗ | ✗ | ✓ |
| Đăng ký vãng lai | ✗ | ✗ | ✓ |
| Mark đã đóng | ✗ | ✗ | ✓ |
| Admin add/remove court (per session) | ✓ | ✓ (update LIVE — bill chưa frozen) | ✓ (chỉ ảnh hưởng card live, không update /lich snapshot) |
| Admin reject vãng lai / pass | n/a | n/a | ✓ |
| Bill / matrix | n/a | live | snapshot |

Vãng lai registration in "Đã đặt sân" is **auto-instant** when capacity
isn't full (Option B) — a `vang_lai` vote is written directly, no admin
approval. Full sessions queue into `extra_slot_requests` and wait for the
auto-match-on-pass mechanism.

## Cutoff sweep (24h before session)

`app/lib/cutoff-sweep.server.ts/sweepExpiredCutoffs` runs lazily from the
`/lich` and `/trang-chu` loaders. For every session whose cutoff has just
passed:

- Open pass → cancelled, voter's vote restored
- Pending vãng lai → rejected
- Claimed-not-confirmed pass → auto-confirmed (seat already transferred)

Idempotent via a `cutoff_locked` audit row per session.

## Capacity vs allocation

Two configs that look alike but mean different things:

- `people_per_hour` (default 3) — **allocation ratio**: 3 voters justify 1h
  of court. Used by the auto-allocation algorithm at lock time.
- `max_people_per_court_hour` (default 6) — **capacity ceiling**: max bodies
  per court-hour. Used to gate vãng lai admission and display "đã đủ" on
  home cards.

Source: `app/lib/extra-slot.server.ts/computeCapacity` (pure formula, used by
both server and home page).

## Audit log

`audit_logs` records every state transition for 90 days. The `AuditKind`
enum lives in `app/db/schema.ts`. Vietnamese copy for it has two forms:

- `kindLabel` — short label for tables / filter chips
- `describeEvent` — full sentence for per-session history sheets

Both in `app/lib/audit-format.ts`. `describeEvent` is **exhaustive** — TS
refuses to compile if a new `AuditKind` is added without copy.

## Money

- Prices live in `config` table keyed by `prices`. Tier × gender matrix:
  `{ thang: { nam, nu }, vang_lai: { nam, nu } }`. Read via `getPrices`.
- VND format: `1.000.000đ` (dot separator, no decimals). Format helper:
  `formatVND` in `app/lib/format.ts`.
- Money transfer happens **outside the system**. The app records intent
  (who owes whom) via `pass_requests` + audit log, but never reconciles
  bank transfers. `member_month_payments` is a self-marked flag, not a
  reconciliation.

## Date & time conventions

- All ms timestamps are UTC; rendering shifts to VN (UTC+7).
- Display: `dd-mm-yyyy` (dash separator). Times: `HH:mm` 24h.
- Canonical helper: `formatMonthYear(year, month) → "MM-YYYY"` in
  `app/lib/dates.ts`. Use it instead of inline template strings.
- Date format helpers: `formatVNDateShort` (yyyy-mm-dd → dd-mm-yyyy),
  `formatDateTime` (ms → "dd-mm-yyyy HH:mm"), `formatDateTimeCompact`
  (ms → "dd-mm HH:mm"), `formatDayMonth` (ms → "dd-mm").
- **Weekday + date pair**: always `<WeekdayDate weekday={...} date={...} />`
  from `app/components/weekday-date.tsx`. Inherits parent's font size and
  text color; never roll your own `{weekday} {formatVNDateShort(date)}`
  inline — that style has drifted in the past.

## UI routes

- `/trang-chu` — member homepage. Shows current month sessions + voting
  banner + payment banner (auto-assigned passes pending confirmation).
- `/lich` — schedule view. Current + next month. Voting months render the
  vote form inline. Locked/done months show the bill + matrix.
- `/admin/sessions/<sessionId>` — per-session court editor (standalone,
  not under the admin tab layout). Linked from each trang-chu session card
  for admin users.
- `/admin/members`, `/admin/config` — admin tabs.
- `/admin` — redirects to `/admin/members`.
- `/vote` — **redirects to /lich** (kept for email URLs).
