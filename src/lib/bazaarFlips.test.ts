import { describe, expect, it } from "vitest"
import { mockBazaarFull } from "./pricing/testUtils"
import { analyseBazaarFlips, prettifyProductId } from "./bazaarFlips"

const NAMES = new Map([["GOOD", "Good Item"]])

/** A healthy two-sided book: buy at 100, sell at 120, plenty of volume. */
const healthy = {
  GOOD: { buy: 120, sell: 100, buyWeek: 1_000_000, sellWeek: 1_000_000 },
}

describe("analyseBazaarFlips", () => {
  it("computes margin net of bazaar tax", () => {
    const [flip] = analyseBazaarFlips(mockBazaarFull(healthy), NAMES)

    expect(flip.buyOrderPrice).toBe(100)
    expect(flip.sellOfferPrice).toBe(120)
    // 120 less 1.25% tax, less the 100 paid.
    expect(flip.margin).toBeCloseTo(120 * 0.9875 - 100, 6)
    expect(flip.marginPct).toBeCloseTo(flip.margin / 100, 6)
    expect(flip.name).toBe("Good Item")
  })

  // Tax eats thin spreads entirely; reporting them as profit is the single most
  // misleading thing a flip list can do.
  it("drops a spread that tax turns negative", () => {
    const thin = { GOOD: { buy: 101, sell: 100, buyWeek: 1_000_000, sellWeek: 1_000_000 } }
    expect(analyseBazaarFlips(mockBazaarFull(thin), NAMES)).toHaveLength(0)
  })

  // An empty side prices at 0, which would read as an infinite margin.
  it("ignores a one-sided book", () => {
    const oneSided = {
      NO_BUYERS: { buy: 500, sell: 0, buyWeek: 1_000_000, sellWeek: 1_000_000 },
      NO_SELLERS: { buy: 0, sell: 500, buyWeek: 1_000_000, sellWeek: 1_000_000 },
    }
    expect(analyseBazaarFlips(mockBazaarFull(oneSided), NAMES)).toHaveLength(0)
  })

  /*
   * The failure mode this filter exists for: the widest percentage spreads
   * belong to products nobody trades, where the book is one lowball buy order
   * under one moonshot sell offer. Neither order would ever fill.
   */
  it("requires volume on both sides, not just one", () => {
    const lopsided = {
      GOOD: { buy: 120, sell: 100, buyWeek: 5_000_000, sellWeek: 10 },
    }
    const bz = mockBazaarFull(lopsided)
    expect(analyseBazaarFlips(bz, NAMES, { minWeeklyVolume: 10_000 })).toHaveLength(0)
    // Only with the floor dropped below the thin side does it appear.
    expect(analyseBazaarFlips(bz, NAMES, { minWeeklyVolume: 5 })).toHaveLength(1)
  })

  it("discards implausibly wide spreads as broken books", () => {
    const broken = { GOOD: { buy: 10_000, sell: 1, buyWeek: 1_000_000, sellWeek: 1_000_000 } }
    expect(analyseBazaarFlips(mockBazaarFull(broken), NAMES)).toHaveLength(0)
    // Raising the ceiling admits it again, so the rejection is the filter and
    // not some other rule.
    expect(analyseBazaarFlips(mockBazaarFull(broken), NAMES, { maxMarginPct: 100_000 })).toHaveLength(1)
  })

  // Both legs must complete, so the slower side sets the pace.
  it("paces throughput on the slower side of the book", () => {
    const uneven = { GOOD: { buy: 120, sell: 100, buyWeek: 1_680_000, sellWeek: 336_000 } }
    const [flip] = analyseBazaarFlips(mockBazaarFull(uneven), NAMES, { minWeeklyVolume: 1000 })

    expect(flip.unitsPerHour).toBeCloseTo(336_000 / 168, 6)
    expect(flip.marketProfitPerHour).toBeCloseTo(flip.margin * flip.unitsPerHour, 6)
  })

  it("honours the tax tier when deciding what is profitable", () => {
    // A margin that only clears once the Bazaar Flipper perk cuts the tax.
    const marginal = { GOOD: { buy: 101.2, sell: 100, buyWeek: 1_000_000, sellWeek: 1_000_000 } }
    const bz = mockBazaarFull(marginal)

    expect(analyseBazaarFlips(bz, NAMES, { tax: "base" })).toHaveLength(0)
    expect(analyseBazaarFlips(bz, NAMES, { tax: "flipperMaxed" })).toHaveLength(1)
  })
})

describe("prettifyProductId", () => {
  it("reads enchanted books as a name and a level", () => {
    expect(prettifyProductId("ENCHANTMENT_ULTIMATE_WISDOM_5")).toBe("Ultimate Wisdom 5")
    expect(prettifyProductId("ENCHANTED_INK_SACK")).toBe("Enchanted Ink Sack")
  })
})
