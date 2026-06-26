import { describe, expect, it } from "vitest";
import { isValidMomoLink } from "./momo-link";

describe("isValidMomoLink", () => {
  it("accepts me.momo.vn", () => {
    expect(isValidMomoLink("https://me.momo.vn/abc123")).toBe(true);
  });

  it("accepts quy.momo.vn (the new admin format)", () => {
    expect(isValidMomoLink("https://quy.momo.vn/payme")).toBe(true);
  });

  it("accepts bare momo.vn", () => {
    expect(isValidMomoLink("https://momo.vn/payme/123")).toBe(true);
  });

  it("accepts any subdomain of momo.vn", () => {
    expect(isValidMomoLink("https://app.momo.vn/x/y")).toBe(true);
    expect(isValidMomoLink("https://transfer.momo.vn/a")).toBe(true);
  });

  it("accepts paths with arbitrary characters (no path restriction)", () => {
    expect(isValidMomoLink("https://me.momo.vn/a/b?c=d&e=f")).toBe(true);
  });

  it("rejects http:// (must be https)", () => {
    expect(isValidMomoLink("http://me.momo.vn/abc")).toBe(false);
  });

  it("rejects domains that aren't momo.vn", () => {
    expect(isValidMomoLink("https://me.notmomo.vn/abc")).toBe(false);
    expect(isValidMomoLink("https://momo.vn.evil.com/abc")).toBe(false);
  });

  it("rejects malformed URLs", () => {
    expect(isValidMomoLink("not a url")).toBe(false);
    expect(isValidMomoLink("")).toBe(false);
  });
});
