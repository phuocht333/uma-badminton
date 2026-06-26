# Uma Badminton — Design Spec

**Date:** 2026-05-20
**Status:** Approved (auto mode)
**Owner:** thienphuoc.huynh@covergo.com

## Purpose

Internal web app for a private badminton group to (1) vote on monthly attendance for fixed Saturday + Sunday sessions, (2) auto-generate the court booking plan, and (3) coordinate slot exchanges when a member can't attend. Vietnamese-only UI. Targets the existing group's known members — no public signup.

## Roles

- **Admin** — manages members, edits config (prices, courts, time slots), can override the auto-generated court allocation, can manually close a vote, can resend the set-password email.
- **Member** — votes monthly attendance, uploads their personal payment QR, marks slots for pass, claims passed slots from others.

## Non-Functional

- **Language:** 100% Vietnamese UI. Neutral/standard register.
- **Stack:** Cloudflare-only — Pages (Remix runtime), D1, R2, KV, Cron Triggers. Email via Resend.
- **Mobile-first:** designed for 360px, works up to desktop.
- **Auth:** email + password, session cookie (HTTP-only, SameSite=Lax, 30 days).

## Decisions Made Autonomously

These decisions were resolved during auto mode without further user input. They are also tracked in `docs/decisions.md` for review.

| # | Decision | Rationale |
|---|---|---|
| D1 | **Framework:** Remix on Cloudflare Pages | Edge-native, single codebase for SSR + API, smaller bundle than Next.js |
| D2 | **ORM:** Drizzle + drizzle-kit | Type-safe, D1-friendly, no Prisma engine binary |
| D3 | **Email provider:** Resend | Simple REST API callable from Workers, cheap, deliverability good for transactional |
| D4 | **Password hashing:** scrypt via WebCrypto (`crypto.subtle`) | Native to Workers runtime, no external dep |
| D5 | **Session storage:** D1 table `sessions` (not KV) | Simpler — one DB; KV consistency not needed for low traffic |
| D6 | **Pass-slot pricing:** receiver pays *vãng lai* rate to the original voter | Original voter still owes the locked tháng-price to the group; the 10k delta compensates them for inconvenience. Money never flows through the app. |
| D7 | **Payment confirmation:** none — no upload-receipt, no Admin tick | Per user instruction Q2 |
| D8 | **Court booking:** app generates plan only, exports as PNG, Admin manually sends to the venue | Per user instruction Q3 |
| D9 | **Notification channel:** email only at MVP | Per user instruction Q4 |
| D10 | **Vãng lai trigger:** any member who didn't vote a given session in the open window but later claims a pass-slot is recorded as `vãng_lai` for that session | Per user instruction Q5 |
| D11 | **Court allocation:** deterministic per config; Admin may edit the result before locking | Per user clarification on Case 1 |
| D12 | **Guests outside the group:** not supported at MVP. Only registered members can claim a pass-slot | Keeps scope tight; group is closed |
| D13 | **Date locale:** Vietnamese — dates as `dd/mm/yyyy`, times 24h `HH:mm`, weekdays as "T7"/"CN" | Workshop convention |
| D14 | **Multi-month history:** members see current + last month only; Admin can view any month | YAGNI for MVP |

## Data Model (D1 / SQLite)

```sql
-- Users: members + admins
CREATE TABLE users (
  id TEXT PRIMARY KEY,                  -- ulid
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('nam','nu')),
  role TEXT NOT NULL CHECK (role IN ('admin','member')) DEFAULT 'member',
  password_hash TEXT,                   -- null until they set it via reset link
  qr_image_key TEXT,                    -- R2 object key
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,          -- unix ms
  updated_at INTEGER NOT NULL
);

CREATE TABLE password_reset_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- A month of play. One row per year+month.
CREATE TABLE months (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,               -- 1..12
  status TEXT NOT NULL CHECK (status IN ('draft','voting','locked','done')),
  vote_open_at INTEGER NOT NULL,
  vote_close_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (year, month)
);

-- Each T7/CN within a month
CREATE TABLE play_sessions (
  id TEXT PRIMARY KEY,
  month_id TEXT NOT NULL REFERENCES months(id),
  date TEXT NOT NULL,                   -- 'YYYY-MM-DD'
  weekday TEXT NOT NULL CHECK (weekday IN ('T7','CN'))
);

CREATE TABLE votes (
  id TEXT PRIMARY KEY,
  play_session_id TEXT NOT NULL REFERENCES play_sessions(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('thang','vang_lai','cho_pass','da_pass')),
  voted_at INTEGER NOT NULL,
  original_voter_id TEXT REFERENCES users(id),   -- set for vãng_lai entries created via pass
  UNIQUE (play_session_id, user_id)
);

CREATE TABLE court_allocations (
  id TEXT PRIMARY KEY,
  play_session_id TEXT NOT NULL REFERENCES play_sessions(id),
  court_code TEXT NOT NULL,             -- 'B1','B2','B4','C3','C4',...
  start_time TEXT NOT NULL,             -- 'HH:mm'
  end_time TEXT NOT NULL,
  display_order INTEGER NOT NULL
);

CREATE TABLE pass_requests (
  id TEXT PRIMARY KEY,
  vote_id TEXT NOT NULL REFERENCES votes(id),
  created_at INTEGER NOT NULL,
  claimed_by_user_id TEXT REFERENCES users(id),
  claimed_at INTEGER
);

-- Key-value config. Values are JSON strings.
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### Config keys (seeded defaults)

```jsonc
"prices" = {
  "thang":    { "nam": 60000, "nu": 50000 },
  "vang_lai": { "nam": 70000, "nu": 60000 }
}

"courts_by_weekday" = {
  "CN": [
    { "code": "B2", "endTime": "10:00", "maxHours": 2 },
    { "code": "B1", "endTime": "10:00", "maxHours": 2 },
    { "code": "B4", "endTime": "10:00", "maxHours": 2 }
  ],
  "T7": [
    { "code": "C3", "endTime": "10:00", "maxHours": 2 },
    { "code": "C4", "endTime": "10:00", "maxHours": 2 },
    { "code": "B4", "endTime": "10:00", "maxHours": 2 }
  ]
}

"people_per_hour" = 3
"min_people_per_session" = 6
"max_people_per_court_hour" = 6   -- soft cap, surfaces warning
"admin_qr_image_key" = "..."      -- R2 key for the group payment QR
```

## Lifecycle of a Month

```
[draft]                  // first time the cron runs for month N
   │ cron 09:00 day 20 of month N-1
   ▼
[voting] ── member votes yes/no per play_session ──┐
   │ cron 23:59 day 27 of month N-1                │
   │ (or Admin "Close now")                        │
   ▼                                                │
[locked] ── pass-slot flow active ──┘
   │ cron at end of month N (informational)
   ▼
[done]
```

- **Open (09:00 ngày 20 tháng N-1):** Cron creates the `months` row (if not exists) + all `play_sessions` for Saturdays and Sundays of month N. Sends invite email to all active members with a link to `/vote`.
- **Voting window (20 → 27):** Members POST yes/no per session. Each "yes" creates a `votes` row with status=`thang`.
- **Close (23:59 ngày 27 tháng N-1):** For each play_session with ≥ `min_people_per_session` voters, run `allocateCourts(numVoters, config)` and persist `court_allocations`. Mark month `locked`. Send summary email to each member with total slots, total fee, and Admin's QR.
- **Locked phase (28 → end of N):** Schedule is frozen. Pass-slot flow takes over for individual day changes.
- **Sessions with < 6 voters:** flagged. No `court_allocations` created. Member-facing UI shows "Buổi này không đủ người, vui lòng liên hệ Admin". Admin can manually force-create allocations.

## Court Allocation Algorithm

Pure function, no DB:

```typescript
function allocateCourts(numPeople: number, weekday: 'T7'|'CN', cfg: Config) {
  const totalHours = Math.floor(numPeople * 2 / cfg.peoplePerHour) / 2;
  const priorities = cfg.courtsByWeekday[weekday];
  let remaining = totalHours;
  const out = [];
  for (let i = 0; i < priorities.length && remaining > 0; i++) {
    const c = priorities[i];
    const take = Math.min(remaining, c.maxHours);
    const startMins = toMinutes(c.endTime) - take * 60;
    out.push({
      courtCode: c.code,
      startTime: fromMinutes(startMins),
      endTime: c.endTime,
      displayOrder: i,
    });
    remaining -= take;
  }
  return { totalHours, allocations: out, overflowHours: remaining };
}
```

If `overflowHours > 0` after the priority list is exhausted, that's surfaced in the Admin UI as a warning. Admin then edits manually.

## Pass-Slot Flow

1. Member A views `/lich`, sees confirmed `vote` for date D (status `thang`). Taps **"Cần pass"**.
   - Creates a `pass_requests` row referencing that vote. Vote status flips to `cho_pass`.
2. Member B views `/pass-slot`, sees A's pending request listed (filter: my own gender? both? — defaults to both, filter is UI-only).
3. Member B taps **"Nhận slot"**.
   - `pass_requests.claimed_by_user_id` = B, `claimed_at` = now.
   - A's vote: status → `da_pass`.
   - Insert a new vote row for B with status `vang_lai`, `original_voter_id = A.id`.
4. UI then shows B: A's QR image + the *vãng lai* price for B's gender. App displays the suggested transfer amount but does not track payment.
5. If A wants to cancel before claim: tap "Huỷ yêu cầu pass" → delete `pass_requests` row, restore A's vote to `thang`.
6. Concurrency: claim is a single UPDATE WHERE claimed_by_user_id IS NULL. First writer wins; UI tells the loser "Slot đã có người nhận, thử slot khác".

Note: claiming does **not** alter `court_allocations` — total attendance stays the same.

## Screens

All paths under root.

| Path | Audience | Purpose |
|---|---|---|
| `/login` | guest | email + password |
| `/set-password?token=...` | guest with token | first-time password set or reset |
| `/quen-mat-khau` | guest | request reset email |
| `/` | member | dashboard: month status, next session, amount due, Admin QR, shortcuts |
| `/vote` | member (during voting) | per-session yes/no toggles |
| `/lich` | member (locked+) | matrix of my participation this month, "Cần pass" buttons |
| `/pass-slot` | member | list open pass requests, claim |
| `/profile` | member | change password, upload QR, view past 2 months |
| `/admin/members` | admin | list, add, edit, resend invite |
| `/admin/config` | admin | prices, courts, hours, ratios |
| `/admin/months` | admin | list months, view+edit current matrix, manual close, export PNG |

## UI Conventions

- Tailwind + shadcn/ui base. Mobile-first (no horizontal scroll at 360px).
- Vietnamese copy reviewed for tone — neutral/standard, not Google-Translate.
- Money: `60.000đ` (dot separator). Dates: `dd/mm/yyyy`. Weekdays: `T7`, `CN`. Times: `HH:mm`.
- One primary action per screen (mobile context).

## Emails (Vietnamese, plain HTML)

1. **Chào mừng + Đặt mật khẩu** — sent when admin creates a member. Set-password link with 7-day token.
2. **Mở vote tháng N** — sent at 09:00 ngày 20 tháng N-1. Includes link to `/vote`.
3. **Kết quả vote tháng N** — sent right after vote close. Includes: list of confirmed sessions, member's total slots, total fee, admin's QR.
4. **Đặt lại mật khẩu** — user-initiated reset.

Provider: Resend, called via `fetch` from the Pages function. `RESEND_API_KEY`, `EMAIL_FROM`, `APP_BASE_URL` from env.

## Cron Schedule

In `wrangler.toml`:

```toml
[triggers]
crons = [
  "0 2 20 * *",     # 09:00 Asia/Ho_Chi_Minh ngày 20 = 02:00 UTC; open vote
  "59 16 27 * *",   # 23:59 Asia/Ho_Chi_Minh ngày 27 = 16:59 UTC; close vote
]
```

Both run the same scheduled handler, which dispatches by current day. All actions idempotent (creating `months` uses `INSERT OR IGNORE`; sending emails checks a `last_sent_at` marker per user per event).

## Out of Scope (MVP)

- Public signup / open invites
- Automated court booking integration
- Payment tracking (paid/unpaid status, bank reconciliation)
- Zalo bot, push notifications
- Guests outside the registered group claiming pass-slots
- Multi-month historical analytics / charts
- Recurring "I always come on Sundays" preset (member always votes manually)
- 2FA, OAuth, social login

## Open Items (Admin to handle out-of-band)

- Sessions with < 6 voters → Admin contacts members manually or forces an allocation.
- Sessions over capacity → Admin asks volunteers to skip via Zalo chat.
- Member who paid the wrong amount → resolved off-app.

## Acceptance Criteria

- A new admin can: create members, see emails sent, edit prices.
- A new member can: receive email, set password, log in, vote, log out.
- Voting open/close runs automatically via cron AND can be manually triggered.
- After close: allocation table generated, fee per member visible, exportable as PNG.
- Pass-slot end-to-end works between two member accounts.
- All copy is Vietnamese; no English fallback strings appear in the UI.
