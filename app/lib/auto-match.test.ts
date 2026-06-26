import { describe, expect, it } from "vitest";
import { computeAutoMatchPayment } from "./auto-match.server";
import { DEFAULT_PRICES } from "./config.server";

describe("computeAutoMatchPayment", () => {
  it("same gender nam → nam: vãng lai pays extra to quỹ (vang_lai − thang)", () => {
    const r = computeAutoMatchPayment("nam", "nam", DEFAULT_PRICES);
    expect(r.toPassSlotter).toBe(70000);
    expect(r.toQuyExtra).toBe(0);
    expect(r.fromQuyShortage).toBe(0);
    expect(r.payerTotal).toBe(70000);
    expect(r.payeeTotal).toBe(70000);
  });

  it("same gender nu → nu: vãng lai pays nu rate", () => {
    const r = computeAutoMatchPayment("nu", "nu", DEFAULT_PRICES);
    expect(r.toPassSlotter).toBe(60000);
    expect(r.toQuyExtra).toBe(0);
    expect(r.fromQuyShortage).toBe(0);
  });

  it("nam vãng lai ↔ nu pass: 10k chênh dương đi vào quỹ", () => {
    const r = computeAutoMatchPayment("nam", "nu", DEFAULT_PRICES);
    expect(r.toPassSlotter).toBe(60000);
    expect(r.toQuyExtra).toBe(10000);
    expect(r.fromQuyShortage).toBe(0);
    expect(r.payerTotal).toBe(70000);
    expect(r.payeeTotal).toBe(60000);
  });

  it("nu vãng lai ↔ nam pass: quỹ phải bù 10k cho nam pass-slotter", () => {
    const r = computeAutoMatchPayment("nu", "nam", DEFAULT_PRICES);
    expect(r.toPassSlotter).toBe(60000);
    expect(r.toQuyExtra).toBe(0);
    expect(r.fromQuyShortage).toBe(10000);
    expect(r.payerTotal).toBe(60000);
    expect(r.payeeTotal).toBe(70000);
  });

  it("custom prices: vẫn áp dụng cùng công thức vang_lai[gender]", () => {
    const r = computeAutoMatchPayment("nam", "nu", {
      thang: { nam: 100000, nu: 90000 },
      vang_lai: { nam: 120000, nu: 100000 },
    });
    expect(r.toPassSlotter).toBe(100000);
    expect(r.toQuyExtra).toBe(20000);
    expect(r.fromQuyShortage).toBe(0);
  });
});
