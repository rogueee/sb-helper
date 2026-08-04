import { describe, expect, it } from "vitest"
import { auctionNetProceeds, auctionTax, bazaarNetProceeds } from "./fees"

describe("auction fees", () => {
  it("charges the listing fee tier matching the price", () => {
    // 1% below 10m: fee 50k, and no collection tax path to confuse it.
    expect(auctionTax(5_000_000)).toBeCloseTo(50_000 + 50_000, 6)
    // 2% between 10m and 100m: 50m -> 1m listing + 500k collection (1% capped
    // by nothing, since 50m - 1m is far above the floor).
    expect(auctionTax(50_000_000)).toBeCloseTo(1_000_000 + 500_000, 6)
    // 2.5% above 100m.
    expect(auctionTax(200_000_000)).toBeCloseTo(5_000_000 + 2_000_000, 6)
  })

  it("does not charge collection tax at or below 1m", () => {
    // Only the 1% listing fee applies.
    expect(auctionNetProceeds(1_000_000)).toBeCloseTo(990_000, 6)
    expect(auctionNetProceeds(400_000)).toBeCloseTo(396_000, 6)
  })

  // The collection tax is capped so it can never drag a claim below 1m, which
  // means just over the threshold it is a fraction of a percent, not a full 1%.
  it("caps collection tax so it cannot pull a claim under 1m", () => {
    const price = 1_005_000
    const listingFee = price * 0.01
    // Uncapped 1% would be 10,050; the cap allows only the 5,000 above 1m.
    expect(price - auctionNetProceeds(price) - listingFee).toBeCloseTo(5_000, 6)
  })

  it("treats a non-positive price as no proceeds", () => {
    expect(auctionNetProceeds(0)).toBe(0)
    expect(auctionNetProceeds(-1)).toBe(0)
  })
})

describe("bazaar tax", () => {
  it("applies the selected tier", () => {
    expect(bazaarNetProceeds(1_000_000)).toBeCloseTo(987_500, 6)
    expect(bazaarNetProceeds(1_000_000, "manualClaim")).toBeCloseTo(988_750, 6)
    expect(bazaarNetProceeds(1_000_000, "flipperMaxed")).toBeCloseTo(990_000, 6)
  })
})
