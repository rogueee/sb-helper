import { describe, expect, it } from "vitest"
import { priceStars } from "./essence"
import { mockBazaar } from "./testUtils"
import type { SkyblockItem } from "../hypixel"

const item: SkyblockItem = {
  id: "TEST_SWORD",
  name: "Test Sword",
  upgrade_costs: [
    [{ type: "ESSENCE", essence_type: "WITHER", amount: 100 }],
    [{ type: "ESSENCE", essence_type: "WITHER", amount: 200 }],
    [{ type: "ESSENCE", essence_type: "WITHER", amount: 300 }],
  ],
}

describe("priceStars", () => {
  it("sums only the prefix of stars actually applied", () => {
    const bz = mockBazaar({ ESSENCE_WITHER: { buy: 10 } })
    const lines = priceStars(bz, item, 2)
    // stars 0 and 1 -> 100 + 200 = 300 essence @ 10 = 3000
    expect(lines).toHaveLength(1)
    expect(lines[0].quantity).toBe(300)
    expect(lines[0].total).toBe(3000)
  })

  it("returns nothing for an unstarred item", () => {
    const bz = mockBazaar({ ESSENCE_WITHER: { buy: 10 } })
    expect(priceStars(bz, item, 0)).toHaveLength(0)
  })

  // Regression: stars past the published essence tiers are Master Stars, which
  // cost tens of millions. Treating them as "not published" silently understated
  // every fully-starred dungeon item by a large margin.
  it("charges master stars for levels beyond the published essence tiers", () => {
    const bz = mockBazaar({
      ESSENCE_WITHER: { buy: 10 },
      FIRST_MASTER_STAR: { buy: 1_000_000 },
      SECOND_MASTER_STAR: { buy: 2_000_000 },
    })
    const lines = priceStars(bz, item, 5)

    const first = lines.find((l) => l.productId === "FIRST_MASTER_STAR")
    const second = lines.find((l) => l.productId === "SECOND_MASTER_STAR")
    expect(first?.total).toBe(1_000_000)
    expect(second?.total).toBe(2_000_000)

    // 3 essence stars (100+200+300 @ 10) + both master stars.
    const total = lines.reduce((sum, l) => sum + (l.total ?? 0), 0)
    expect(total).toBe(6_000 + 3_000_000)
  })

  it("distinguishes an empty order book from an unknown product", () => {
    // Listed on the bazaar but with no standing offers.
    const bz = mockBazaar({ ESSENCE_WITHER: { buy: 10 }, FIRST_MASTER_STAR: { buy: 0 } })
    const lines = priceStars(bz, item, 4)
    const star = lines.find((l) => l.productId === "FIRST_MASTER_STAR")
    expect(star?.total).toBeNull()
    expect(star?.note).toBe("no sell offers")
  })
})
