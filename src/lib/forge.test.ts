import { describe, expect, it } from "vitest"
import { mockBazaar } from "./pricing/testUtils"
import {
  FORGE_RECIPES,
  formatForgeTime,
  isPetId,
  quickForgeMultiplier,
  valueForgeFlip,
  type ForgeRecipe,
} from "./forge"

const NO_NAMES = new Map<string, string>()
const NO_LBIN = new Map<string, number>()

/** One material, one hour, one output — enough to check the arithmetic. */
const recipe: ForgeRecipe = {
  output: "WIDGET",
  count: 1,
  seconds: 3600,
  inputs: [{ id: "COG", qty: 10 }],
}

describe("quickForgeMultiplier", () => {
  it("matches the published curve", () => {
    expect(quickForgeMultiplier(1)).toBeCloseTo(0.895, 6) // 10.5% off
    expect(quickForgeMultiplier(19)).toBeCloseTo(0.805, 6) // 19.5% off
    expect(quickForgeMultiplier(20)).toBeCloseTo(0.7, 6) // 30% off
  })

  // The formula would claim 10% at level 0, but level 0 means the perk is not
  // unlocked at all.
  it("gives no reduction without the perk", () => {
    expect(quickForgeMultiplier(0)).toBe(1)
    expect(quickForgeMultiplier(-5)).toBe(1)
  })
})

describe("valueForgeFlip", () => {
  it("prices materials at instabuy and the output at the bazaar sell offer", () => {
    const bz = mockBazaar({ COG: { buy: 100 }, WIDGET: { buy: 2_000, sell: 1_800 } })
    const flip = valueForgeFlip(bz, recipe, NO_LBIN, NO_NAMES)

    expect(flip.materialCost).toBe(1_000)
    expect(flip.saleSource).toBe("bazaar")
    expect(flip.saleGross).toBe(2_000)
    // 1.25% bazaar tax on the sale.
    expect(flip.saleNet).toBeCloseTo(1_975, 6)
    expect(flip.profit).toBeCloseTo(975, 6)
    expect(flip.hours).toBe(1)
    expect(flip.profitPerHour).toBeCloseTo(975, 6)
  })

  /*
   * Refined Mithril really does quote an instabuy near 596k against an
   * instasell near 8.6k — its buy-order book is empty, not its value. Valuing
   * forge output by instasell would post a fictional quarter-million loss, so
   * the default is the sell offer and both prices stay visible.
   */
  it("offers instant sale as a separate, conservative mode", () => {
    // Materials cost 250k, between the two quoted prices, so the choice of
    // book flips the verdict rather than merely nudging it.
    const bz = mockBazaar({ COG: { buy: 25_000 }, WIDGET: { buy: 600_000, sell: 8_600 } })

    const offer = valueForgeFlip(bz, recipe, NO_LBIN, NO_NAMES)
    expect(offer.saleGross).toBe(600_000)
    expect(offer.profit!).toBeGreaterThan(0)

    const instant = valueForgeFlip(bz, recipe, NO_LBIN, NO_NAMES, { sellMode: "instant" })
    expect(instant.saleGross).toBe(8_600)
    expect(instant.profit!).toBeLessThan(0)

    // Both sides of the book travel with the result either way, so a 70x gap
    // is visible rather than silently believed.
    expect(offer.bazaarAlternative).toEqual({ offer: 600_000, instant: 8_600 })
    expect(instant.bazaarAlternative).toEqual({ offer: 600_000, instant: 8_600 })
  })

  // Drill parts, beacons and crystals are auction-only. Without this fallback
  // every recipe consuming one is unpriceable, which hides most of the forge.
  it("prices an auction-only material from lowest BIN", () => {
    const bz = mockBazaar({ WIDGET: { buy: 5_000_000 } })
    const flip = valueForgeFlip(bz, recipe, new Map([["COG", 400]]), NO_NAMES)

    expect(flip.materialCost).toBe(4_000)
    expect(flip.inputs[0].source).toBe("auction")
    expect(flip.inputs[0].note).toBe("AH lbin")
    expect(flip.unpriced).toEqual([])
  })

  it("prefers the bazaar over lowest BIN for a material sold on both", () => {
    const bz = mockBazaar({ COG: { buy: 100 }, WIDGET: { buy: 5_000 } })
    const flip = valueForgeFlip(bz, recipe, new Map([["COG", 999]]), NO_NAMES)

    expect(flip.materialCost).toBe(1_000)
    expect(flip.inputs[0].source).toBe("bazaar")
  })

  // The auction house is the realistic venue for anything with an lbin, and its
  // fee structure is completely different from the bazaar's.
  it("prefers AH lowest BIN over the bazaar and taxes it as an auction", () => {
    const bz = mockBazaar({ COG: { buy: 100 }, WIDGET: { sell: 2_000 } })
    const flip = valueForgeFlip(bz, recipe, new Map([["WIDGET", 5_000_000]]), NO_NAMES)

    expect(flip.saleSource).toBe("auction")
    expect(flip.saleGross).toBe(5_000_000)
    // 1% listing fee + 1% collection tax above 1m.
    expect(flip.saleNet).toBeCloseTo(4_900_000, 6)
  })

  // Auction tax is tiered on a single listing's price, so a stack of four 5m
  // items must not be taxed as one 20m sale.
  it("taxes a multi-output forge per unit, not on the stack total", () => {
    const stack: ForgeRecipe = { ...recipe, count: 4 }
    const bz = mockBazaar({ COG: { buy: 100 } })
    const flip = valueForgeFlip(bz, stack, new Map([["WIDGET", 5_000_000]]), NO_NAMES)

    expect(flip.saleGross).toBe(20_000_000)
    expect(flip.saleNet).toBeCloseTo(4_900_000 * 4, 6)
  })

  /*
   * The safety property that matters here runs opposite to the craft
   * calculator's. There, an omitted component understates craft cost and makes
   * a listing look worse. Here, an omitted material understates cost and
   * *overstates* profit — inventing a flip that does not exist. So one
   * unpriceable input has to void the whole recipe.
   */
  it("refuses to price a recipe with an unpriceable material", () => {
    const bz = mockBazaar({ WIDGET: { buy: 2_000 } })
    const flip = valueForgeFlip(bz, recipe, NO_LBIN, NO_NAMES)

    expect(flip.materialCost).toBeNull()
    expect(flip.profit).toBeNull()
    expect(flip.profitPerHour).toBeNull()
    expect(flip.unpriced).toEqual(["COG"])
  })

  it("reports no sale when the output trades nowhere", () => {
    const bz = mockBazaar({ COG: { buy: 100 } })
    const flip = valueForgeFlip(bz, recipe, NO_LBIN, NO_NAMES)

    expect(flip.materialCost).toBe(1_000)
    expect(flip.saleSource).toBeNull()
    expect(flip.profit).toBeNull()
  })

  it("values a coin cost at face value rather than looking it up", () => {
    const coins: ForgeRecipe = {
      ...recipe,
      inputs: [{ id: "SKYBLOCK_COIN", qty: 300_000 }],
    }
    const bz = mockBazaar({ WIDGET: { buy: 500_000 } })
    const flip = valueForgeFlip(bz, coins, NO_LBIN, NO_NAMES)

    expect(flip.materialCost).toBe(300_000)
    expect(flip.unpriced).toEqual([])
  })

  it("shortens the forge time by the Quick Forge level", () => {
    const bz = mockBazaar({ COG: { buy: 100 }, WIDGET: { buy: 2_000 } })
    const flip = valueForgeFlip(bz, recipe, NO_LBIN, NO_NAMES, { quickForge: 20 })

    expect(flip.hours).toBeCloseTo(0.7, 6)
    // Same profit spread over less time is a better flip.
    expect(flip.profitPerHour!).toBeCloseTo(975 / 0.7, 6)
  })
})

describe("forge recipe data", () => {
  it("carries a positive duration and at least one input for every recipe", () => {
    expect(FORGE_RECIPES.length).toBeGreaterThan(50)
    for (const r of FORGE_RECIPES) {
      expect(r.seconds).toBeGreaterThan(0)
      expect(r.inputs.length).toBeGreaterThan(0)
      for (const input of r.inputs) {
        expect(input.qty).toBeGreaterThan(0)
        // A quantity left glued to the id ("FLAWLESS_AMBER_GEM:2.0") matches no
        // bazaar product and would silently drop the material from the cost.
        expect(input.id).not.toMatch(/:[\d.]+$/)
      }
    }
  })

  it("knows Refined Mithril's real recipe", () => {
    const refined = FORGE_RECIPES.find((r) => r.output === "REFINED_MITHRIL")
    expect(refined).toBeDefined()
    expect(refined!.inputs).toEqual([{ id: "ENCHANTED_MITHRIL", qty: 160 }])
    expect(refined!.seconds).toBe(6 * 3600)
  })

  it("recognises pet outputs, which are priced by level and not modelled", () => {
    expect(isPetId("AMMONITE;4")).toBe(true)
    expect(isPetId("REFINED_MITHRIL")).toBe(false)
  })
})

describe("formatForgeTime", () => {
  it("picks a unit that keeps the number readable", () => {
    expect(formatForgeTime(30 / 3600)).toBe("30s")
    expect(formatForgeTime(0.5)).toBe("30m")
    expect(formatForgeTime(6)).toBe("6h")
    expect(formatForgeTime(168)).toBe("7d")
  })
})
