import { describe, expect, it } from "vitest"
import { mockBazaar } from "./testUtils"
import { valuate } from "./valuate"
import type { ExtraAttributes } from "../nbt"

const item = { id: "HYPERION", name: "Hyperion" } as Parameters<typeof valuate>[2]

function withEnchants(enchantments: Record<string, number>): ExtraAttributes {
  return { id: "HYPERION", enchantments } as ExtraAttributes
}

describe("enchant lines", () => {
  const bz = mockBazaar({
    ENCHANTMENT_ULTIMATE_WISDOM_5: { buy: 40_000_000 },
    ENCHANTMENT_ULTIMATE_ONE_FOR_ALL_1: { buy: 90_000_000 },
    ENCHANTMENT_SHARPNESS_6: { buy: 1_000_000 },
    ENCHANTMENT_HECATOMB_1: { buy: 5_000_000 },
  })

  /*
   * "Ultimate" is a namespace in the NBT and on the Bazaar, not part of the
   * name anyone uses — nobody says "Ultimate Wisdom V". The game distinguishes
   * these by colour, so the label drops the prefix and the line carries a tint
   * instead.
   */
  it("drops the Ultimate prefix and tints the line", () => {
    const v = valuate(bz, withEnchants({ ultimate_wisdom: 5 }), item)
    const line = v.lines.find((l) => l.group === "enchants")!

    expect(line.label).toBe("Wisdom 5")
    expect(line.label).not.toMatch(/Ultimate/i)
    expect(line.accent).toBe("ultimate")
    expect(line.total).toBe(40_000_000)
  })

  it("handles a multi-word ultimate", () => {
    const v = valuate(bz, withEnchants({ ultimate_one_for_all: 1 }), item)
    const line = v.lines.find((l) => l.group === "enchants")!

    expect(line.label).toBe("One For All 1")
    expect(line.accent).toBe("ultimate")
  })

  it("leaves ordinary enchants untinted and unrenamed", () => {
    const v = valuate(bz, withEnchants({ sharpness: 6 }), item)
    const line = v.lines.find((l) => l.group === "enchants")!

    expect(line.label).toBe("Sharpness 6")
    expect(line.accent).toBeUndefined()
  })

  // Hecatomb climbs to X through dungeon runs from a level 1 book. Combining
  // 2^9 level 1 books would be a cost nobody ever pays, and since craft cost is
  // subtracted from the listing price it would manufacture a fake deal.
  it("charges Hecatomb X as a single level 1 book", () => {
    const v = valuate(bz, withEnchants({ hecatomb: 10 }), item)
    const line = v.lines.find((l) => l.group === "enchants")!

    expect(line.label).toBe("Hecatomb 10")
    expect(line.total).toBe(5_000_000)
    expect(line.quantity).toBe(1)
    expect(line.note).toBe("levels up in use — lvl 1 book only")
  })

  it("keeps every enchant on its own line", () => {
    const v = valuate(
      bz,
      withEnchants({ ultimate_wisdom: 5, sharpness: 6, hecatomb: 10 }),
      item,
    )
    const enchants = v.lines.filter((l) => l.group === "enchants")

    expect(enchants).toHaveLength(3)
    expect(enchants.filter((l) => l.accent === "ultimate")).toHaveLength(1)
    expect(v.componentTotal).toBe(40_000_000 + 1_000_000 + 5_000_000)
  })
})
