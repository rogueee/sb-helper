import { describe, expect, it } from "vitest"
import { formatCoins } from "./format"

describe("formatCoins", () => {
  // Regression: trim() used to strip trailing zeros unconditionally, which
  // mangled whole-number results — 480,000,000 rendered as "48m" and
  // 500,000,000 as "5m" — discovered via a live Hyperion auction sweep where
  // real round-number BIN prices (480m, 500m) silently lost digits.
  it("does not eat trailing zeros off whole-number results", () => {
    expect(formatCoins(480_000_000)).toBe("480m")
    expect(formatCoins(500_000_000)).toBe("500m")
    expect(formatCoins(600_000_000)).toBe("600m")
    expect(formatCoins(1_000_000_000)).toBe("1b")
    expect(formatCoins(20_000)).toBe("20k")
    expect(formatCoins(100)).toBe("100")
  })

  it("still trims fractional trailing zeros", () => {
    expect(formatCoins(5_000_000)).toBe("5m")
    expect(formatCoins(2_500_000)).toBe("2.5m")
    expect(formatCoins(40_000_000)).toBe("40m")
  })

  it("keeps significant fractional digits", () => {
    expect(formatCoins(2_530_000)).toBe("2.53m")
    expect(formatCoins(45_600_000)).toBe("45.6m")
  })

  it("handles null and negative values", () => {
    expect(formatCoins(null)).toBe("—")
    expect(formatCoins(-479_000_000)).toBe("-479m")
  })
})
