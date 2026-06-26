# Uma Badminton 🏸

App nội bộ quản lý vote tháng + đổi slot cho nhóm cầu lông. UI 100% tiếng Việt, deploy trên Cloudflare Workers (Static Assets + D1 + R2 + KV + Cron Triggers), email qua Resend.

> **Spec đầy đủ:** [`docs/superpowers/specs/2026-05-20-uma-badminton-design.md`](docs/superpowers/specs/2026-05-20-uma-badminton-design.md)
>
> **Quyết định tự động (auto mode):** [`docs/decisions.md`](docs/decisions.md)

---

## Tech stack

| Phần | Công cụ |
|---|---|
| Framework | Remix + Vite |
| Hosting | Cloudflare Workers (Static Assets binding) |
| Database | Cloudflare D1 (SQLite) + Drizzle ORM |
| Storage | Cloudflare R2 (ảnh QR) |
| Key-value | Cloudflare KV (cron locks, rate limit) |
| Cron | Cloudflare Cron Triggers (UTC) |
| Email | Resend REST API (gọi từ Worker) |
| UI | Tailwind + Radix UI (shadcn-style) |
| Lang | TypeScript strict |

---

## Setup lần đầu

### 1. Clone & install

```bash
pnpm install
cp .dev.vars.example .dev.vars   # rồi sửa giá trị
```

### 2. Tạo D1, KV, R2 trên Cloudflare

```bash
pnpm wrangler d1 create uma_badminton_db
# -> copy database_id vào wrangler.toml

pnpm wrangler kv:namespace create KV
# -> copy id vào wrangler.toml

pnpm wrangler r2 bucket create uma-badminton-qr
```

### 3. Apply migrations

```bash
# local (cho dev)
pnpm db:migrate:local

# remote (cho production)
pnpm db:migrate:remote
```

### 4. Seed config + admin bootstrap

```bash
# local
ADMIN_EMAIL=admin@uma.vn ADMIN_NAME="Phuoc" pnpm db:seed:local

# remote
ADMIN_EMAIL=admin@uma.vn ADMIN_NAME="Phuoc" pnpm db:seed:remote
```

Script in ra link `/set-password?token=...` — mở link đó để đặt mật khẩu admin lần đầu.

### 5. Cấu hình secrets (production)

```bash
pnpm wrangler secret put RESEND_API_KEY
pnpm wrangler secret put SESSION_SECRET   # random ≥ 32 ký tự
```

`SESSION_SECRET` trong dev đặt trong `.dev.vars`.

---

## Lệnh thường dùng

```bash
pnpm dev              # local dev (Vite + Wrangler dev proxy)
pnpm build            # build production
pnpm deploy           # build + wrangler deploy
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest run

pnpm db:generate      # Drizzle: tạo migration mới từ schema thay đổi
pnpm db:migrate:local # áp migration cho D1 local
pnpm db:migrate:remote
pnpm db:studio        # Drizzle Studio (UI quản lý DB)
```

---

## Cấu trúc thư mục

```
app/
├── components/      # UI primitives (button, card, ...) + app-shell
├── db/              # Drizzle schema + client
├── lib/             # business logic (auth, vote, allocate-courts, email, ...)
├── routes/          # Remix routes (file-based)
└── styles/          # Tailwind globals
docs/
├── decisions.md     # quyết định tự động (auto mode)
└── superpowers/specs/  # design spec
migrations/          # Drizzle-generated SQL
scripts/seed.ts      # bootstrap config + admin
worker.ts            # Worker entry (fetch + scheduled)
wrangler.toml        # Cloudflare config (D1, KV, R2, cron)
```

---

## Cron Triggers (giờ Việt Nam, UTC+7)

Cron chạy **hàng ngày**, handler check ngày hiện tại với config (`vote_open_day` / `vote_close_day`) — chỉ dispatch khi trùng.

| Cron (UTC) | Giờ VN | Tác dụng |
|---|---|---|
| `0 2 * * *` | 09:00 mỗi ngày | Nếu trùng `vote_open_day` (mặc định 5) → mở vote tháng kế tiếp + gửi email |
| `59 16 * * *` | 23:59 mỗi ngày | Nếu trùng `vote_close_day` (mặc định 25) → đóng vote + gen lịch sân + email tổng kết + cleanup log > 90 ngày |

Admin có thể đổi `vote_open_day` / `vote_close_day` tại `/admin/config` mà không cần redeploy. Có thể trigger thủ công từ `/admin/months` ("Mở vote tháng sau" / "Đóng vote").

---

## Vận hành hàng tháng

1. Ngày 5 (mặc định): hệ thống tự gửi mail mời vote.
2. Thành viên vào `/vote` chọn buổi (CN, T7) muốn đánh, có thể sửa lại trước 25.
3. Ngày 25 (mặc định) đêm: hệ thống tự đóng vote, tính giờ sân, gen lịch.
4. Admin vào `/admin/months/YYYY-MM` xem bảng → "Xuất PNG" → gửi nhà sân book.
5. Mỗi member nhận email tổng kết kèm QR Admin → tự chuyển khoản.
6. Trong tháng: ai bận thì vào `/lich` bấm "Cần pass slot", người khác vào `/pass-slot` nhận. Người nhận chuyển trực tiếp cho người pass theo giá đã đóng (không qua app).
7. Mọi hành động (vote, pass, sửa sân) được ghi vào `/admin/log` (lưu 90 ngày).

---

## Troubleshooting

**"Cron không chạy"** — kiểm tra `wrangler tail` xem fired chưa, và verify cron trong dashboard CF.

**"Email không gửi"** — verify domain trong Resend, check `RESEND_API_KEY`, xem `wrangler tail` lỗi `[email] resend failed`.

**"Allocation sai"** — kiểm tra `/admin/config` (sân + tỉ lệ người/giờ). Có thể edit JSON trực tiếp. Pure function ở `app/lib/allocate-courts.ts` có test (`pnpm test`).
