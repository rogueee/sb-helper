import { describe, expect, it } from "vitest"
import { priceEnchant } from "./enchants"
import { mockBazaar } from "./testUtils"

describe("priceEnchant", () => {
  it("buys the level directly when that is cheapest", () => {
    const bz = mockBazaar({
      ENCHANTMENT_SHARPNESS_5: { buy: 1000 },
      ENCHANTMENT_SHARPNESS_6: { buy: 1500 },
    })
    const result = priceEnchant(bz, "sharpness", 6)
    expect(result.total).toBe(1500)
    expect(result.boughtLevel).toBe(6)
  })

  it("combines two lower-level books when that beats the direct price", () => {
    // Level 6 is absurdly overpriced relative to two level-5s combined.
    const bz = mockBazaar({
      ENCHANTMENT_SHARPNESS_5: { buy: 1000 },
      ENCHANTMENT_SHARPNESS_6: { buy: 50000 },
    })
    const result = priceEnchant(bz, "sharpness", 6)
    expect(result.total).toBe(2000)
    expect(result.boughtLevel).toBe(5)
    expect(result.boughtQty).toBe(2)
  })

  it("walks multiple levels down when that is cheapest overall", () => {
    // lvl4 unpriced, lvl3 cheap enough that 8x it (3 combine-steps to reach lvl6) still wins.
    const bz = mockBazaar({
      ENCHANTMENT_GROWTH_3: { buy: 100 },
      ENCHANTMENT_GROWTH_5: { buy: 100000 },
      ENCHANTMENT_GROWTH_6: { buy: 200000 },
    })
    const result = priceEnchant(bz, "growth", 6)
    // 8 x lvl3 = 800, vastly cheaper than any direct level.
    expect(result.total).toBe(800)
    expect(result.boughtLevel).toBe(3)
    expect(result.boughtQty).toBe(8)
  })

  it("reports unpriced when no level is sold on the bazaar", () => {
    const bz = mockBazaar({})
    const result = priceEnchant(bz, "mythical", 1)
    expect(result.total).toBeNull()
  })

  // Many enchants only have liquidity at their top level — nobody trades
  // Critical 1-5 when Critical 6 is what everyone buys. Pricing from the level
  // above was tried and rejected: charging a Magmarizer 6 book for an item that
  // only has Magmarizer 5 inflated craft costs enough to invent deals that were
  // not there. A higher level must never leak into the price.
  it("does not price from a higher level when the exact level has no market", () => {
    const bz = mockBazaar({
      ENCHANTMENT_CRITICAL_5: { buy: 0 }, // listed, empty order book
      ENCHANTMENT_CRITICAL_6: { buy: 20_000 },
    })
    const result = priceEnchant(bz, "critical", 5)
    expect(result.total).toBeNull()
    expect(result.note).toBe("no sell offers at any level")
  })

  // Hecatomb is applied from a level 1 book and climbs to X through dungeon
  // runs. No higher book exists to buy and no combining happens, so charging
  // 2^9 level 1 books for Hecatomb X would be a cost nobody ever pays — and
  // since craft cost is subtracted from the listing price, that inflation would
  // manufacture deals that are not there.
  it("charges one level 1 book for a self-levelling enchant at any level", () => {
    const bz = mockBazaar({ ENCHANTMENT_HECATOMB_1: { buy: 5_000_000 } })

    const ten = priceEnchant(bz, "hecatomb", 10)
    expect(ten.total).toBe(5_000_000)
    expect(ten.boughtQty).toBe(1)
    expect(ten.productId).toBe("ENCHANTMENT_HECATOMB_1")
    expect(ten.note).toBe("levels up in use — lvl 1 book only")

    // Level 1 is the same purchase, so it needs no explanation.
    expect(priceEnchant(bz, "hecatomb", 1).total).toBe(5_000_000)
    expect(priceEnchant(bz, "hecatomb", 1).note).toBeUndefined()
  })

  it("reports a self-levelling enchant as unpriced when its lvl 1 book has no offers", () => {
    const bz = mockBazaar({ ENCHANTMENT_HECATOMB_1: { buy: 0 } })
    const result = priceEnchant(bz, "hecatomb", 8)
    expect(result.total).toBeNull()
    expect(result.note).toBe("no sell offers")
  })

  it("still combines down when a lower level is purchasable", () => {
    const bz = mockBazaar({
      ENCHANTMENT_CRITICAL_4: { buy: 100 },
      ENCHANTMENT_CRITICAL_5: { buy: 0 },
      ENCHANTMENT_CRITICAL_6: { buy: 20_000 },
    })
    const result = priceEnchant(bz, "critical", 5)
    expect(result.total).toBe(200) // 2 x lvl 4
    expect(result.boughtLevel).toBe(4)
  })
})
