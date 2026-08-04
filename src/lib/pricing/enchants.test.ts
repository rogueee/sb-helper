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
  // Critical 1-5 when Critical 6 is what everyone buys. Without this fallback a
  // typical Hyperion showed ~19 unpriced lines, gutting the comparison.
  it("substitutes the next purchasable level up when the exact level has no market", () => {
    const bz = mockBazaar({
      ENCHANTMENT_CRITICAL_5: { buy: 0 }, // listed, empty order book
      ENCHANTMENT_CRITICAL_6: { buy: 20_000 },
    })
    const result = priceEnchant(bz, "critical", 5)
    expect(result.total).toBe(20_000)
    expect(result.substituted).toBe(true)
    expect(result.boughtLevel).toBe(6)
    expect(result.note).toContain("no lvl 5 market")
  })

  it("prefers combining down over substituting up when both are possible", () => {
    const bz = mockBazaar({
      ENCHANTMENT_CRITICAL_4: { buy: 100 },
      ENCHANTMENT_CRITICAL_5: { buy: 0 },
      ENCHANTMENT_CRITICAL_6: { buy: 20_000 },
    })
    const result = priceEnchant(bz, "critical", 5)
    expect(result.total).toBe(200) // 2 x lvl 4
    expect(result.substituted).toBeUndefined()
  })

  it("does not substitute from arbitrarily far above the target", () => {
    const bz = mockBazaar({ ENCHANTMENT_CRITICAL_10: { buy: 500 } })
    const result = priceEnchant(bz, "critical", 1)
    expect(result.total).toBeNull()
  })
})
