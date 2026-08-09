# Quyết định tự động (auto mode)

File này ghi các quyết định mình tự ra trong quá trình build auto, để bạn review sau. Mỗi entry có thể revert hoặc đổi — chỉ nói "đổi D3" là mình refactor.

## Quyết định tech

| ID | Quyết định | Lý do |
|---|---|---|
| D1 | **Remix on Cloudflare Pages** (thay vì Next.js) | Edge-native hơn, bundle nhỏ, integration với CF mượt hơn |
| D2 | **Drizzle ORM** cho D1 | Type-safe, không cần binary engine như Prisma |
| D3 | **Resend** cho email | REST API gọi từ Worker được, free tier 100 mail/ngày |
| D4 | **scrypt qua WebCrypto** cho hash password | Có sẵn trong Workers runtime, không cần lib ngoài |
| D5 | **Session lưu trong bảng D1**, không dùng KV | Đơn giản hơn — một DB, traffic thấp nên không cần KV |
| D6 | **shadcn/ui + Tailwind** | Component đẹp sẵn, dễ customize, mobile-first |
| D7 | **ULID** cho ID (không UUID) | Sortable theo thời gian, ngắn hơn UUID |
| D8 | **html-to-image** để export PNG bảng | Lib client-side, không cần render server |
| D9 | **Workers + Static Assets** (KHÔNG dùng Pages) | Pages không hỗ trợ Cron Triggers; Workers Assets là pattern CF khuyến nghị từ 2024, cho phép 1 worker handle cả static + SSR + cron |

## Quyết định business / product

| ID | Quyết định | Lý do |
|---|---|---|
| ~~B1~~ | ~~**Pass-slot: người nhận trả giá vãng lai**, người pass giữ chênh lệch 10k~~ | **REVISED** xem B1.v2 |
| B1.v2 | **Pass-slot: người nhận chuyển đúng giá tháng (theo giới tính người pass) cho người pass**. App không tạo vote mới cho người nhận; A vẫn nguyên bill nhưng vote chuyển thành `da_pass` (không hiển nút pass lại). Không thừa không thiếu, không "phí công". | Bỏ logic chênh lệch theo yêu cầu mới. |
| B11.v2 | **Cho phép filter giới tính trên trang pass-slot** (chip/select). Mặc định "Tất cả". | Theo yêu cầu mới. |
| B15 | **Pass-slot list sắp xếp theo `pass_request.created_at` ASC** (FIFO — ai request sớm nhất hiển thị trên cùng). Claim vẫn atomic UPDATE (first writer wins). | Theo yêu cầu mới. |
| B16 | **Audit log**: ghi 7 loại event (vote_added, vote_removed, pass_requested, pass_cancelled, pass_claimed, court_added, court_removed). Lưu **90 ngày**; cleanup tự động trong cron đóng vote hàng tháng. | Theo yêu cầu mới. |
| B17 | **Admin có UI add/remove court allocation thủ công** sau khi đóng vote, dùng cho case "đặt thêm được sân" hoặc "phải huỷ sân". | Cần để hỗ trợ event court_added/court_removed. |
| B18 | **Vote window mặc định: mở ngày 5, đóng ngày 25** (của tháng trước tháng vote). Admin sửa được hai số này trong `/admin/config`. | Theo yêu cầu mới (đổi từ 20-27 sang 5-25). |
| A7 | **Cron đổi sang daily** (2 trigger/ngày, 09:00 VN + 23:59 VN). Handler check `today.day` so với config `vote_open_day` / `vote_close_day` rồi mới dispatch. | Cloudflare cron static trong wrangler.toml nên không thể đổi theo config; daily + filter trong handler là pattern chuẩn. |
| D10 | **Design tokens chuyển sang Geist + ink/canvas/accent/hairline** (theo design-system skill), thay shadcn HSL var cũ. Loại bỏ Inter. Font load qua Google Fonts. | Yêu cầu áp dụng design system; engineer-minimal aesthetic phù hợp với app nội bộ. |
| B19 | **Auto refund khi Admin huỷ sân**: vote `cho_pass` trên session có sân vừa huỷ sẽ tự chuyển sang status mới `hoan_tien`. Không tính vào bill. | Theo yêu cầu mới — Admin huỷ sân → người đang chờ pass được hoàn tiền. |
| B20 | **Member request vãng lai khi không có pass-slot**: trên `/lich`, các buổi member chưa vote → có nút "Đăng ký vãng lai". Tạo `extra_slot_requests` (pending). | Theo yêu cầu mới — case không có slot pass nhưng vẫn muốn đánh. |
| B21 | **Admin approval gắn với "court_added"**: khi Admin thêm sân cho session, pending requests trên session đó tự approve → tạo vote `vang_lai` cho requester. Admin cũng approve thủ công được. | Theo yêu cầu mới — admin confirm = đặt thêm sân. |
| B22 | **Vote status mới `hoan_tien`**: enum giờ có 5 giá trị (`thang`, `vang_lai`, `cho_pass`, `da_pass`, `hoan_tien`). `hoan_tien` không tính tiền. | Cần để model refund. |
| B2 | **Không có guest ngoài nhóm** — chỉ member đã có account mới nhận pass slot | Giữ scope hẹp cho MVP, nhóm đóng |
| B3 | **Không track payment** — không upload bill, không Admin tick | Theo câu trả lời Q2 |
| B4 | **App không tự book sân** — chỉ gen plan + export PNG | Theo câu trả lời Q3 |
| B5 | **Chỉ email** ở MVP, không in-app/Zalo notification | Theo câu trả lời Q4 |
| B6 | **Member chỉ xem 2 tháng** (hiện tại + tháng vừa qua); Admin xem tất cả | YAGNI cho MVP |
| B7 | **Số người < 6/buổi:** không gen allocation, hiển thị "không đủ người, liên hệ Admin" | Theo rule cứng |
| B8 | **Số người > max sân:** UI cảnh báo Admin, Admin xử lý tay | Theo rule cứng |
| B9 | **Vote close cũng làm được thủ công** bởi Admin, không chỉ đợi cron | Đề phòng cron lỗi hoặc cần đóng sớm |
| B10 | **`weekday` enum:** chỉ T7 và CN | Lịch cố định theo spec |
| B11 | **Filter pass-slot mặc định: tất cả** (không filter theo giới tính) | Đơn giản, member tự nhìn |
| B12 | **Email tổng kết gửi từng member riêng**, kèm số tiền cá nhân + QR Admin | Privacy tốt hơn email chung |
| B13 | **Mỗi member có thể vote/un-vote nhiều lần** trong window 20-27 | Cho phép đổi ý |
| B14 | **Vote là per-session** (mỗi T7/CN một vote), không "vote cả tháng" 1 click | Đơn giản về data model, UI vẫn cho check all/uncheck all |
| B23 | **Auto-match coexist với manual claim** trên cùng pool pass-slot. Event-driven: chạy mỗi khi có pass-slot create, vãng lai register, hoặc manual claim cancel/unconfirm. Helper `tryAutoMatch(playSessionId)` gọi sau mỗi mutation liên quan. | Manual claim cho UX chủ động, auto-match đảm bảo không bỏ sót khi 2 pool đều có pending. |
| ~~B24~~ | ~~**Cutoff đăng ký/match = `min(courtAllocations.startTime trên session) − 24h`**, lazy compute mỗi lần check. Sau cutoff: khoá đăng ký pass-slot + vãng lai mới + flip pending sang admin queue.~~ **BỎ HOÀN TOÀN — xem B34.** | Cutoff trước sân sớm nhất đảm bảo admin có thời gian xử lý queue trước khi bất kỳ sân nào bắt đầu. |
| B25 | **Auto-match algorithm: FIFO thuần**, không phân biệt giới tính. Match `extra_slot_request.created_at ASC` đầu hàng với `pass_request.created_at ASC` đầu hàng. Một event = match 1 cặp tối đa (atomic). | Đơn giản, đối xứng, dễ test. Khác giới xử lý ở payment routing (B26). |
| B26 | **Cross-gender match payment routing**: vãng lai trả giá tháng theo giới *của mình*; pass-slotter nhận giá tháng theo giới *của họ*; chênh dương → quỹ chung (vãng lai trả thêm vào quỹ); chênh âm → quỹ bù (pass-slotter nhận một phần từ quỹ, tự báo admin qua Zalo group). **App KHÔNG track balance quỹ** — chỉ hiển thị hướng dẫn thanh toán trong email + UI. Quỹ là khái niệm vận hành ngoài app. | Giữ B1.v2 semantics "đúng giá theo giới" nhưng không phá symmetry; tránh phải build ledger phức tạp. |
| B27 | **Match = chốt cứng**. Vote flip ngay tại match (1 transaction nguyên tử: `passRequest.claimedAt`/`claimedByUserId`/`confirmedAt` set, vote chuyển `da_pass`, vote mới `vang_lai` tạo cho vãng lai, `extra_slot_request.approvedAt` set, audit log ghi). Không có nút "Đã chuyển" tách biệt cho auto-match. Không cancel, không timeout. Đổi ý → dùng pass-slot flow bình thường. | Hạn chế state phức tạp; auto-match phản ánh ý chí đã có sẵn (cả 2 bên đã chủ động hành động). |
| B28 | **Admin queue per-person** với nút "Duyệt tất cả" tiện lợi. List sắp xếp FIFO theo created_at. Hành động "thêm sân" (B17) và "duyệt vãng lai" tách rời. **Phá B21** — court_added không còn auto-approve tất cả pending. | Linh hoạt cho edge case (member nợ tiền, đặc cách, gender balance); tách rõ 2 concern (đặt sân vs duyệt người). |
| B29 | **Pass-slot reject → vote revert về `thang`**, bill tính như đã đánh. Thêm `rejectedAt` + `rejectedByUserId` vào `passRequests` để giữ lịch sử "đã thử pass nhưng bị reject". | Không thêm vote status mới; query history dễ. |
| B30 | **Vãng lai reject → không tạo vote**. Thêm `rejectedAt` + `rejectedByUserId` vào `extra_slot_requests` (phân biệt với `cancelledAt` của user-initiated). | Phân biệt nguyên nhân để UX message khác nhau ("bạn đã rút" vs "admin reject vì..."). |
| B31 | **Email cho 6 outcome states + admin digest tại cutoff** (mục (6) digest đã bị **B34** bỏ): (1) auto-match success → 2 emails (vãng lai + pass-slotter); (2) vãng lai duyệt; (3) vãng lai reject; (4) pass-slot duyệt (hoàn tiền); (5) pass-slot reject; (6) admin digest "session X có N pending" tại cutoff. Email auto-match ghi cụ thể số tiền + link app cho QR/STK. | Reject email quan trọng để user kịp sắp xếp khác; admin digest tránh quên cutoff. |
| B32 | **Audit log kinds mới**: `auto_matched`, `vang_lai_rejected`, `pass_rejected`, `cutoff_locked` (kind `cutoff_locked` thành legacy sau **B34** — giữ trong enum cho log cũ). Schema enum cần extend tương ứng. | Track đầy đủ các sự kiện mới của flow auto-match cho debugging + member history. |
| B33 | **Pass slot không còn bị cutoff chặn — sửa B24.** Hệ thống KHÔNG tự huỷ pass slot quá hạn nữa: pass đang mở vẫn hiển thị bình thường trên /trang-chu và vẫn nhận/huỷ được sau cutoff. Bỏ 3 guard `isAfterCutoff` trong `pass-slot.server.ts` (requestPass / cancelPass / claimAndConfirm) và bỏ bước huỷ-pass trong `cutoff-sweep.server.ts`. Cutoff vẫn áp cho **vãng lai** (chặn đăng ký mới, sweep reject pending) và vẫn gửi admin digest (B31.6). **Mở rộng thành B34 — bỏ cutoff hoàn toàn.** Pass còn tồn đọng → admin tự xem, tự chọn duyệt hoàn tiền (`approvePassRefund`) hoặc từ chối (`rejectPassRequest`). | Nhóm nhỏ, quyết định người thật tốt hơn quy tắc tự động: hệ thống huỷ pass rồi đẩy người pass về lại bill gây tranh cãi, trong khi sân vẫn có thể có người nhận sát giờ. Admin nắm ngữ cảnh Zalo group nên để admin chốt. |
| B34 | **Bỏ hoàn toàn logic cutoff — thay B24.** Không còn khái niệm deadline 24h trong app: `session-cutoff.server.ts` và `cutoff-sweep.server.ts` bị xoá, guard `isAfterCutoff` biến mất khỏi `pass-slot.server.ts` / `extra-slot.server.ts` / `auto-match.server.ts`, sweep lazy trong loader `/lich` + `/trang-chu` bỏ, cron digest `sweepCutoffsForAdminDigest` + email `sendAdminCutoffDigestEmail` bỏ. Hệ quả: pass slot + đăng ký/huỷ vãng lai + auto-match FIFO chạy bình thường tới sát giờ đánh; **không có gì tự huỷ, tự reject, tự confirm nữa**. Điều kiện duy nhất còn lại là tháng phải ở trạng thái "Đã đặt sân". Hàng đợi tồn đọng = admin tự xem trang buổi rồi duyệt / từ chối tay. | Nhóm nhỏ, admin nắm ngữ cảnh Zalo group nên quyết định người thật luôn đúng hơn deadline tự động; deadline chỉ tạo ra state "bị hệ thống huỷ" gây tranh cãi và chặn cả những vụ đổi slot sát giờ vẫn hợp lệ. |
| B35 | **Buổi diễn ra hôm nay vẫn thao tác được đầy đủ.** `isLocked` trong `home-summary.server.ts` đổi từ `date <= today` sang `date < today`, nên card của buổi hôm nay còn nguyên nút pass / huỷ pass / nhận slot / đăng ký vãng lai / duyệt vãng lai / sửa sân. Buổi đã qua (`date < today`) vẫn bị ẩn khỏi `/trang-chu` như cũ và chỉ xử lý ở `/admin/sessions/:id`. | Người ta bỏ buổi vào đúng sáng hôm đánh — khoá nguyên ngày đánh là khoá đúng lúc cần dùng nhất. Bổ sung cho B34: server đã không còn deadline, giờ UI cũng thôi. |

## Quyết định kiến trúc

| ID | Quyết định | Lý do |
|---|---|---|
| A1 | **Single Remix app**, không tách FE+BE | Internal app cỡ nhỏ, monolith hợp hơn |
| A2 | **Cron handler là module riêng** trong worker entry, dispatch theo ngày | Idempotent, dễ test, dễ trigger thủ công |
| A3 | **Court allocation là pure function** trong `app/lib/allocate-courts.ts` | Dễ unit test, không phụ thuộc DB |
| A4 | **Migration files trong `/migrations`** (Drizzle generate) | Standard Drizzle layout |
| A5 | **R2 cho ảnh QR** (không base64 trong DB) | Tách binary khỏi relational data |
| A6 | **Vietnamese ID slug cho route nhạy cảm:** `/quen-mat-khau`, `/lich`, `/pass-slot` | UX tốt cho user VN |

## Câu hỏi mà mình tự assume khi gặp trong lúc build (sẽ append vào đây)

_Mỗi khi auto build mà gặp 1 chỗ không rõ, mình ghi vào đây dạng:_

> **AUTO-Q1:** [Câu hỏi]
> **Giả định:** [Mình chọn gì]
> **Tác động:** [Đổi thì refactor cái gì]
