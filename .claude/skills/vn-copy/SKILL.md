---
name: vn-copy
description: BA — tối ưu hoá từ ngữ, hướng dẫn, thông báo, label tiếng Việt cho thành viên nhóm cầu lông. Đối tượng người Việt chơi cầu lông amateur, mobile-first. Triggers: copy, wording, label, button, error message, toast, notification, hướng dẫn, UI text, content review, rephrase, viết lại, dịch lại, polish text, audit copy.
---

# Vietnamese Copy — Uma Badminton

Audit và viết lại text trong app — labels, buttons, errors, toasts, hướng dẫn — sao cho thành viên nhóm cầu lông đọc xong **hiểu ngay phải làm gì**, không cần ngẫm. Mỗi câu chỉ tồn tại nếu nó giúp người chơi đưa ra quyết định nhanh hơn.

## Role

Đóng vai BA (business analyst) đọc copy như một thành viên nhóm cầu lông cấp 28-40 tuổi, đang dùng điện thoại trong/sau buổi đánh. Họ KHÔNG đọc kỹ — họ scan. Họ KHÔNG biết jargon tiếng Anh. Họ KHÔNG có thời gian học.

Mục tiêu mỗi lần can thiệp:
1. **Cắt** từ thừa cho đến khi không cắt được nữa
2. **Đổi** từ Hán-Việt formal sang tiếng nói hàng ngày
3. **Cụ thể hoá** — thay "vui lòng nhập thông tin" bằng "nhập số slot"
4. **Match vocabulary** với CONTEXT.md (đừng tự đặt từ mới)
5. **Đọc to lên** — nếu thấy gượng, viết lại

## Hard rules

Không bao giờ:
- Bắt đầu bằng "**Vui lòng**" — formal quá, lãng phí từ
- "**Click vào đây**" — Anh hoá. Dùng "**Bấm**" hoặc verb cụ thể
- "**Hệ thống**" làm chủ ngữ trong UX text — dịch thành "**Tự động**" hoặc bỏ đi
- "**Quý khách**", "**Quý thành viên**" — đây là nhóm bạn, không phải ngân hàng
- "**Thông tin**" / "**Dữ liệu**" trong button — quá generic. Dùng object thật
- Đặt từ tiếng Anh giữa câu tiếng Việt nếu có equivalent tự nhiên (vd: "**process**" → "**xử lý**", "**confirm**" → "**xác nhận**")
- Dấu ba chấm cuối câu hoàn chỉnh ("Đang gửi...") chỉ dùng cho **loading state**, không cho hover hint

Bắt buộc:
- **Xưng "bạn"**, không "anh/chị/em" (trung tính, không thiên vị)
- **Verb đứng đầu trong button**: "Đăng ký", "Huỷ", "Xác nhận", "Thêm sân"
- **Số tiền** dùng `formatVND(amount)` → "50.000đ", không "50k VNĐ" / "50000 đ"
- **Ngày tháng** dùng helper trong `app/lib/dates.ts` → "dd-mm-yyyy" với dấu gạch
- **Tên thành viên** in đậm trong audit log + thông báo (qua `<AuditDescription>`)
- **Mobile-first**: label ≤ 16 ký tự, button ≤ 14 ký tự
- **Tone trung tính-thân thiện**: không quá khô (như app ngân hàng), không quá teen (không emoji random)

## CONTEXT.md vocabulary — DÙNG NGUYÊN, không tự dịch lại

Đọc `CONTEXT.md` ở root project trước khi viết bất kỳ copy nào liên quan tới domain. Từ điển tối thiểu:

| Concept | UI label | Tuyệt đối tránh |
|---|---|---|
| `voting` month | "Đang mở vote" | "Đang bỏ phiếu", "Mở phiếu" |
| `locked` month | "Đã khoá" | "Đã đóng vote", "Bị khoá" |
| `done` month | "Đã đặt sân" | "Đã chốt", "Đã hoàn tất" |
| `thang` vote | "Đã đăng ký tháng" / "Đăng ký tháng" | "Vote tháng", "Đăng ký cố định" |
| `vang_lai` vote | "Vãng lai" | "Walk-in", "Đăng ký lẻ", "Buổi lẻ" |
| `cho_pass` vote | "Chờ pass" | "Đang chuyển nhượng", "Pass đang đợi" |
| `da_pass` vote | "Đã pass" | "Đã chuyển", "Đã nhường" |
| `hoan_tien` | "Hoàn tiền" / "Không tham gia" | "Refund" |
| Pass slot | "Pass slot" | "Nhượng slot", "Chuyển slot" |
| Pass slot action verb | "Pass slot" (verb), "Nhận slot" (claim) | "Nhường", "Đăng bán slot" |
| Quỹ chung | "quỹ" / "Quỹ chung" | "Ngân quỹ", "Quỹ nhóm" |
| Auto-match | "auto-match" (vẫn giữ trong UI) | "tự ghép cặp" — đã lock theo codebase |
| Cutoff 24h | "trước buổi 24h" | "deadline", "hạn chót" |
| Extra slot (guest) | "vãng lai" (cùng bucket) hoặc "VL N" suffix khi expand | "Khách mời", "Guest slot" |

Nếu reach 1 concept không có trong list — **mở `CONTEXT.md` thêm row**, đừng tự đặt tên.

## Pattern theo loại text

### Button (CTA)
- **Verb + object ngắn**: "Đăng ký vãng lai", "Pass slot", "Khoá vote ngay"
- **Tránh** verb chung chung: "Thực hiện", "Xác nhận thông tin", "Tiếp tục"
- **State variations**: idle → "Đăng ký 2 slot"; submitting → "Đang gửi..."; success → "Đã gửi"; disabled → giữ label gốc + tooltip giải thích

### Error message
Cấu trúc 3 phần (cắt được phần nào thì cắt):
1. **Vì sao**: "Đã qua hạn đăng ký vãng lai (trước buổi 24h)"
2. **Phải làm gì**: "Liên hệ Admin"
3. (optional) Số liệu: amounts/dates

Tránh: "Đã có lỗi xảy ra. Vui lòng thử lại sau." — vô dụng. Cụ thể hoá:
- "Không gửi được. Mạng yếu hay sao đó — thử lại nhé."
- "Slot đã có người nhận khác."
- "Số slot phải từ 1 đến 5."

### Confirmation prompt (dialog)
- **Title**: hành động dạng câu hỏi hoặc khẳng định ngắn — "Pass slot này?"
- **Description**: hậu quả + chuyện gì xảy ra tiếp theo — "Slot của bạn sẽ vào danh sách pass. Bạn có thể huỷ trước khi có người nhận."
- **Confirm button**: lặp lại verb của title — "Pass slot"
- **Cancel button**: "Huỷ" (không "Đóng", "Quay lại", "Không")

### Status badge
- ≤ 3 chữ
- Noun phrase, không verb: "Đã pass", "Chờ duyệt", "Vãng lai"
- Tone match với semantic — accent cho đang chờ hành động, muted cho passive

### Toast / notification
- **Subject (in đậm) + verb + outcome ngắn**
- 6s auto-dismiss → đủ đọc 2 câu
- Có CTA link nếu cần hành động tiếp ("Xem trong Thanh toán →")
- Ví dụ chuẩn:
  - "**Bạn** đã match pass slot của **A**. Chuyển 50.000đ cho **A**."
  - "Slot của **bạn** đã được **B** nhận. **B** sẽ chuyển 50.000đ cho bạn."

### Empty state
- 1 câu giải thích trạng thái + 1 hint hành động (nếu có)
- "Không có giao dịch nào đang chờ."
- "Chưa có ai pass slot. Đăng ký vãng lai nếu muốn đánh."

### Audit log line (per-session history)
- Subject (tên) + verb + object + (optional) số liệu
- Tên người luôn in đậm qua `<AuditDescription>`
- Ví dụ:
  - "**Phuoc** đã đăng ký 2 slot vãng lai và đang chờ được pass slot hoặc admin duyệt"
  - "**Hùng** xác nhận đã chuyển 50k cho **Phuoc** và đã chuyển 10k cho quỹ"
  - "Admin đã hoàn tiền cho **Phuoc** từ tiền quỹ"

### Long-form hướng dẫn (tooltip / note)
- ≤ 2 câu
- Câu 1: bối cảnh ("Nếu đăng ký giùm khác giới")
- Câu 2: số liệu cụ thể ("giá vãng lai Nữ là 40.000đ/slot — tính riêng số tiền tương ứng")

## Process khi audit copy

Khi user yêu cầu "review copy" / "tối ưu từ ngữ" / chỉ ra 1 màn hình cụ thể:

1. **Mở `CONTEXT.md`** — chắc chắn không xài lại từ sai vocab
2. **List tất cả text trên màn hình đó**: labels, buttons, placeholders, errors, helper text, toast
3. **Đối chiếu Hard rules** — flag mọi vi phạm (Vui lòng, Click, Hệ thống làm chủ ngữ, …)
4. **Đối chiếu Pattern theo loại** — đúng cấu trúc chưa?
5. **Đọc to** — phát âm trong đầu. Câu nào gượng → đánh dấu rewrite
6. **Đề xuất bản viết lại bên cạnh bản gốc**, kèm 1 dòng lý do mỗi thay đổi
7. **Đợi user duyệt** trước khi apply
8. Khi apply: dùng Edit/MultiEdit precise, không touch logic xung quanh

## Anti-pattern dễ trượt (drift gần đây trong codebase)

Đã sửa rồi nhưng đừng để tái phạm:

| Sai | Đúng | Lý do |
|---|---|---|
| "Sẽ nhận" (incoming payment section) | "Được nhận" | User dùng "được" — past participle cảm giác nhận thật |
| "Người đang pass" | "Người đang pass" (giữ) | OK vì verb cụ thể |
| "Đăng ký vãng lai" (always) | "Đăng ký thêm vãng lai" khi user đã có vote | Context-aware |
| "Huỷ vãng lai chờ" (bulk) | "Huỷ" per row | Per-row clearer |
| Banner persistent + tab Thanh toán | Toast 6s + card link + tab | Single source of truth |
| "A đã đăng ký vãng lai" | "A đã đăng ký 2 slot vãng lai và đang chờ được pass slot hoặc admin duyệt" | Quantity + state |

## Quick check trước khi ship

- [ ] Mọi domain term match `CONTEXT.md`
- [ ] Không có "Vui lòng" / "Click" / "Hệ thống" làm chủ ngữ
- [ ] Button verb đứng đầu, ≤ 14 ký tự
- [ ] Error message có vì-sao + phải-làm-gì
- [ ] Toast có in đậm tên người (qua `<AuditDescription>` nếu là audit) và CTA link
- [ ] Số tiền qua `formatVND`, ngày qua helper
- [ ] Đọc to 360px width — vừa khít, không xuống dòng xấu
- [ ] Không emoji random (chỉ ✓ trong success state hoặc khi user explicit yêu cầu)

## Không can thiệp vào

- **Code identifiers** (variable names, type names, file names) — tiếng Anh, không đổi
- **Comment trong code** — tiếng Anh, không đổi
- **Migration SQL** — không touch
- **Audit kind enum** (`pass_requested`, `auto_matched`, …) — không đổi
- **PR description, commit message** — tiếng Anh hoặc theo convention dự án

Skill này chỉ động vào **chuỗi text user-facing trong files .tsx, .ts** và **Vietnamese label/description trong `audit-format.ts`**.
