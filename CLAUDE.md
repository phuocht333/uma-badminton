# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

`uma-badminton` is an **internal app** for a private badminton group. Scope is intentionally small: members vote on sessions and exchange slots when they can't attend. Not a consumer product — no public signup, no marketing surface, no analytics-driven growth loops. Treat it as a tool for a closed group of known users.

## Read this first

- **`CONTEXT.md`** — the domain glossary (Member, Month, Vote, Pass request, lifecycle rules). Read it before naming things or reasoning about state. If you reach for a term that's not in `CONTEXT.md`, **add it there** in the same change, so the language stays canonical.
- **`app/lib/pass-slot.spec.md`** — the spec for the pass-slot lifecycle (claim race, multi-hop chain, auto-assign FIFO). Mirror it in real tests when a miniflare/D1 harness is wired up.
- **Memory** — `MEMORY.md` (Claude auto-memory) tracks architecture decisions and feedback rules from prior sessions. Always check it before suggesting refactors that have been litigated.

## Non-negotiable constraints

- **Vietnamese-only UI.** Every label, button, error message, email, push notification, and toast is in Vietnamese. No English fallback strings in the UI layer. Code identifiers stay English; user-facing copy is Vietnamese. Use neutral/standard Vietnamese.
- **Cloudflare stack only.** Deploys exclusively on Cloudflare services. Do not introduce Vercel, Supabase, AWS, or other hosting/data providers without explicit approval. Building blocks:
  - Remix on Cloudflare Workers (static assets + SSR)
  - Cloudflare D1 (SQLite) via Drizzle ORM
  - Cloudflare KV for ephemeral state (sessions, rate limits)
  - Cloudflare R2 for QR images
  - Cloudflare Email Routing (`send_email` binding)
  - Cron Triggers for vote-open/close/done transitions
- **Mobile-first.** Members open this on a phone during/after a session. Design for 360px width first.
- **Internal app posture.** Auth gates access from the homepage; no anonymous browsing.
- **Money format**: VND as `1.000.000đ` (dot separator, no decimals). Helper: `formatVND` in `app/lib/format.ts`.
- **Date format**: `dd-mm-yyyy` with **dashes** (project convention — `formatVNDateShort`, `formatDateTime`, `formatMonthYear`). 24h times as `HH:mm`. Never inline a `${month}/${year}` template — always go through a helper in `app/lib/dates.ts`.

## Parent workspace inheritance

This repo sits inside the Vietnamese Solo Product Workshop (`/Users/phuochuynh/Documents/personalStuff/CLAUDE.md`). The parent's product-thinking guidance (mobile-first, Zalo-shareable, cost-controlled, 2-week MVP) applies — **except** the default tech stack. The Cloudflare-only constraint above overrides the parent's Next.js+Vercel+Supabase default.

## Architecture cheat-sheet

| Concern | Module |
|---|---|
| Vote ↔ seat ownership rule | `app/lib/seat-attribution.ts` (pure) |
| Pass-slot state machine | `app/lib/pass-slot.server.ts` (only home for state transitions; preconditions centralised in `assert*` helpers) |
| Vãng lai flow (admin-gated) | `app/lib/extra-slot.server.ts` |
| Empty-court hiding for locked months | `app/lib/sessions.ts/visibleSessions` |
| Hours-needed formula (head count → giờ sân) | `app/lib/allocate-courts.ts/calculateTotalHours` (pure) |
| Session head count (seats, deduped) | `app/lib/home-summary.server.ts` → `SessionView.playerCount` |
| Matrix builder (used by /lich + /admin) | `app/lib/month-matrix.server.ts` |
| Trang-chu loader logic | `app/lib/home-summary.server.ts` |
| Pass-request join helper | `app/lib/pass-request-enrich.server.ts` |
| Audit log Vietnamese copy | `app/lib/audit-format.ts` (exhaustive — TS enforces all kinds) |
| Date / month-year formatters | `app/lib/dates.ts` |
| Court allocation algorithm | `app/lib/allocate-courts.ts` (pure, tested) |
| Integration test harness (in-memory SQLite + D1 shim) | `app/lib/__tests__/harness.ts` |
| Cross-table data integrity invariants (I1–I4) | `app/lib/__tests__/invariants.ts` |
| Pass-slot / vãng lai test design spec | `app/lib/pass-slot.spec.md` |

## How to work in this repo

1. **Brainstorm before building.** Misunderstanding the voting / slot-exchange flow wastes more time than asking. Use `superpowers:brainstorming` for non-trivial feature work.
2. **One concern per change.** Voting, slot exchange, member management, notifications — each is a separable unit. Don't bundle them into one mega-PR.
3. **Test against the Vietnamese copy.** When changing UI strings, read them aloud — if they feel like Google-Translate Vietnamese, rewrite.
4. **Money handling stays external.** The app never reconciles bank transfers. Pass-slot payments use the homepage banner + "Đã thanh toán" confirm; vãng lai shows QR after admin approval. Never invent an in-app wallet.
5. **Cloudflare API outages happen.** Wrangler deploys occasionally fail with `entitlements.not_available` (Cloudflare-side). Retry. Don't change the build to "work around" it.
6. **Deploy on explicit request only.** Never run `pnpm wrangler deploy` or `pnpm deploy` without the user typing "deploy".

## Coding rules

- **Best practices > cleverness.** Prefer clarity. SOLID where it earns its keep, YAGNI by default, DRY when it removes drift (not when it adds abstraction).
- **Caveman lite.** Prefer consolidation over deeper abstraction. A 5-line helper extracted because it appeared 3 times is good. A "framework" for one caller is bad.
- **Pure functions get tests.** I/O-bound code gets the `…spec.md` stub treatment until the test harness exists. Pure helpers (seat-attribution, sessions, capacity, dates, audit-format) live alongside `*.test.ts` files.
- **Server-only code uses `.server.ts` suffix.** Anything that imports D1 / R2 / email bindings.
- **Migrations are forward-only.** Each schema change ships a new `migrations/000N_*.sql`. Never edit a prior migration.
- **Audit on mutation.** Every state transition that members care about gets an `audit(…)` call with the right `AuditKind`. New kinds → update both `kindLabel` and `describeEvent` in `audit-format.ts` (TS will refuse the build otherwise).
- **Exhaustive switches.** When switching over a string-literal union (e.g. `AuditKind`), drop the `default` branch and add `const _: never = e.kind` so TS catches drift.

## Common operations

```bash
pnpm typecheck          # tsc --noEmit
pnpm test               # vitest run (pure-function tests)
pnpm build              # remix vite:build
pnpm db:migrate:local   # apply migrations to local D1
pnpm db:migrate:remote  # apply migrations to remote D1
pnpm db:seed-test:local # seed diverse test fixtures
```

`pnpm deploy` is intentionally off-limits unless the user types "deploy".

## When ambiguous

- **Naming**: check `CONTEXT.md` first. If the term doesn't exist there yet, add it.
- **A rule contradiction**: prefer the more specific source. Repo `CLAUDE.md` overrides parent. `CONTEXT.md` overrides folk wisdom. User instructions override everything.
- **Refactor proposal**: re-read project memory before suggesting. Past sessions have argued some refactors out of scope ("seat attribution is the swap rule's single home", "allocation vs capacity configs are distinct") — those decisions stand.
