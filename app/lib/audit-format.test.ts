import { describe, it, expect } from "vitest";
import { describeEvent, kindLabel } from "./audit-format";

describe("describeEvent", () => {
  it("pass_confirmed no meta → 'X đã nhận slot của Y'", () => {
    expect(
      describeEvent({
        kind: "pass_confirmed",
        actorName: "Phát",
        subjectName: "Hùng",
        meta: null,
      }),
    ).toBe("Phát đã nhận slot của Hùng");
  });

  it("pass_confirmed with toPassSlotter shows amount", () => {
    expect(
      describeEvent({
        kind: "pass_confirmed",
        actorName: "Phát",
        subjectName: "Hùng",
        meta: { toPassSlotter: 50000 },
      }),
    ).toBe("Phát xác nhận đã chuyển 50k cho Hùng");
  });

  it("pass_confirmed with quỹ extra shows both", () => {
    expect(
      describeEvent({
        kind: "pass_confirmed",
        actorName: "Phát",
        subjectName: "Hùng",
        meta: { toPassSlotter: 50000, toQuyExtra: 10000 },
      }),
    ).toBe("Phát xác nhận đã chuyển 50k cho Hùng và đã chuyển 10k cho quỹ");
  });

  it("pass_confirmed only quỹ (instant vãng lai)", () => {
    expect(
      describeEvent({
        kind: "pass_confirmed",
        actorName: "Tâm",
        subjectName: null,
        meta: { toQuyOnly: 60000 },
      }),
    ).toBe("Tâm xác nhận đã chuyển 60k cho quỹ");
  });

  it("vang_lai_approved with admin actor reads 'admin duyệt'", () => {
    expect(
      describeEvent({
        kind: "vang_lai_approved",
        actorName: "Admin",
        subjectName: "Nhung",
        meta: null,
      }),
    ).toBe(
      "Admin đã duyệt đăng ký vãng lai của Nhung, Nhung đăng ký vãng lai thành công",
    );
  });

  it("vang_lai_approved null actor reads 'hệ thống tự duyệt'", () => {
    expect(
      describeEvent({
        kind: "vang_lai_approved",
        actorName: null,
        subjectName: "Nhung",
        meta: null,
      }),
    ).toBe("Hệ thống tự duyệt vãng lai cho Nhung (đủ chỗ)");
  });

  it("vang_lai_rejected null actor → legacy cutoff-sweep row", () => {
    expect(
      describeEvent({
        kind: "vang_lai_rejected",
        actorName: null,
        subjectName: "Nhung",
        meta: null,
      }),
    ).toBe("Hệ thống từ chối vãng lai của Nhung (quá hạn cutoff)");
  });

  it("court_added pulls courtCode/start/end from meta", () => {
    expect(
      describeEvent({
        kind: "court_added",
        actorName: "Admin",
        subjectName: null,
        meta: { courtCode: "B2", startTime: "08:00", endTime: "10:00" },
      }),
    ).toBe("Admin thêm sân B2 08:00–10:00");
  });

  it("refund_issued by admin reads 'admin đã hoàn tiền cho X từ tiền quỹ'", () => {
    expect(
      describeEvent({
        kind: "refund_issued",
        actorName: "Admin",
        subjectName: "Tâm",
        meta: null,
      }),
    ).toBe("Admin đã hoàn tiền cho Tâm từ tiền quỹ");
  });

  it("refund_issued reason=court_removed → 'sân bị huỷ'", () => {
    expect(
      describeEvent({
        kind: "refund_issued",
        actorName: "Admin",
        subjectName: "Tâm",
        meta: { reason: "court_removed" },
      }),
    ).toBe("Tâm được hoàn tiền (sân bị huỷ)");
  });

  it("payment_marked uses actor name", () => {
    expect(
      describeEvent({
        kind: "payment_marked",
        actorName: "A",
        subjectName: null,
        meta: null,
      }),
    ).toBe("A đánh dấu đã đóng tiền tháng");
  });

  it("every AuditKind has a non-empty describeEvent output", () => {
    for (const kind of Object.keys(kindLabel) as Array<keyof typeof kindLabel>) {
      const text = describeEvent({
        kind,
        actorName: "X",
        subjectName: "Y",
        meta: null,
      });
      expect(text, `describeEvent(${kind}) returned empty`).toBeTruthy();
    }
  });

  it("null actor on pass_requested falls back to 'Hệ thống'", () => {
    expect(
      describeEvent({
        kind: "pass_requested",
        actorName: null,
        subjectName: null,
        meta: null,
      }),
    ).toBe("Hệ thống đã pass slot");
  });

  it("auto_matched reads 'subject đã pass slot cho actor thành công'", () => {
    expect(
      describeEvent({
        kind: "auto_matched",
        actorName: "Nhung",
        subjectName: "Hùng",
        meta: { payerName: "Nhung" },
      }),
    ).toBe("Hùng đã pass slot cho Nhung thành công");
  });

  it("pass_rejected by admin", () => {
    expect(
      describeEvent({
        kind: "pass_rejected",
        actorName: "Admin",
        subjectName: "Hùng",
        meta: null,
      }),
    ).toBe("Admin đã từ chối pass slot của Hùng");
  });

  it("vang_lai_rejected by admin", () => {
    expect(
      describeEvent({
        kind: "vang_lai_rejected",
        actorName: "Admin",
        subjectName: "Nhung",
        meta: null,
      }),
    ).toBe(
      "Admin đã từ chối đăng ký vãng lai của Nhung, Nhung đăng ký vãng lai thất bại",
    );
  });
});
