import { describe, expect, it } from "vitest";
import { DEFAULT_PRICES } from "./config.server";
import { priceForPassClaim, priceForVangLaiQuy } from "./pricing";

describe("priceForPassClaim", () => {
  it("uses thang × owner gender when original voter was thang", () => {
    expect(priceForPassClaim({ originalVoteStatus: "thang" }, "nam", DEFAULT_PRICES)).toBe(
      DEFAULT_PRICES.thang.nam,
    );
    expect(priceForPassClaim({ originalVoteStatus: "thang" }, "nu", DEFAULT_PRICES)).toBe(
      DEFAULT_PRICES.thang.nu,
    );
  });

  it("uses vang_lai × owner gender when original voter was vang_lai", () => {
    expect(priceForPassClaim({ originalVoteStatus: "vang_lai" }, "nam", DEFAULT_PRICES)).toBe(
      DEFAULT_PRICES.vang_lai.nam,
    );
    expect(priceForPassClaim({ originalVoteStatus: "vang_lai" }, "nu", DEFAULT_PRICES)).toBe(
      DEFAULT_PRICES.vang_lai.nu,
    );
  });

  it("respects custom price table", () => {
    const prices = {
      thang: { nam: 100, nu: 80 },
      vang_lai: { nam: 50, nu: 40 },
    };
    expect(priceForPassClaim({ originalVoteStatus: "thang" }, "nam", prices)).toBe(100);
    expect(priceForPassClaim({ originalVoteStatus: "vang_lai" }, "nu", prices)).toBe(40);
  });
});

describe("priceForVangLaiQuy", () => {
  it("returns vang_lai × gender from the price table", () => {
    expect(priceForVangLaiQuy("nam", DEFAULT_PRICES)).toBe(DEFAULT_PRICES.vang_lai.nam);
    expect(priceForVangLaiQuy("nu", DEFAULT_PRICES)).toBe(DEFAULT_PRICES.vang_lai.nu);
  });
});
