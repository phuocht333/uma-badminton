# User Flows — Uma Badminton

2 user journey, mermaid, chỉ những gì người dùng cần làm.

## 1. Member

```mermaid
flowchart LR
  V[Vote các buổi muốn đánh] --> W[Đợi 'Đã đặt sân']
  W --> S{Tình huống}
  S --> P[Bận → Pass slot]
  S --> J[Đi đánh bình thường]
  S --> X[Muốn đánh thêm]
  X --> N[Nhận slot có sẵn]
  X --> R[Đăng ký vãng lai]
  N --> T[Chuyển tiền + 'Đã thanh toán']
  R --> T
  P --> J
  T --> J
  J --> M[Cuối tháng → đóng tiền + 'Đã đóng tiền tháng này']
```

## 2. Admin

```mermaid
flowchart LR
  K[Khoá vote] --> E[Chỉnh sân/giờ từng buổi nếu cần]
  E --> F["Chốt 'Đã đặt sân'"]
  F --> A{Trong tháng có việc?}
  A --> VL[Yêu cầu vãng lai → Duyệt / Từ chối]
  A --> RF[Pass slot không ai nhận → Hoàn tiền / Từ chối]
  A --> S[Cần đổi sân buổi nào đó → vào /admin/sessions chỉnh]
```

Lưu ý:
- **Member** không cần biết thuật ngữ trạng thái — UI tự dẫn (banner "Đang mở vote", "Cần thanh toán", v.v.).
- **Admin** thao tác chính qua `/lich` (toàn tháng) + `/admin/sessions/<id>` (per buổi).
- Tiền chuyển khoản handle ngoài hệ thống; app chỉ ghi nhận "đã chuyển" / "đã đóng".
