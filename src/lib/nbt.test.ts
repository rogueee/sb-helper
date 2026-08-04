import { describe, expect, it } from "vitest"
import { decodeItemBytes } from "./nbt"

/**
 * A real BIN listing pulled from `/v2/skyblock/auctions` during development
 * (POWER_WITHER_CHESTPLATE): recombobulated, 15 potato books, two gem slots,
 * an "ancient" stone reforge, 5 stars, and 6 enchantments including an
 * ultimate. Deliberately dense so one fixture exercises every modifier path
 * the pricing engine cares about.
 */
const FIXTURE_ITEM_BYTES =
  "H4sIAAAAAAAA/11UTU8jRxAtr4E1Dln2RiIlUisJCZbBa3vGXyiK5DVfjlhA2Gu0iqJRe6ZsT5jptnp6AN/2tqfcckmUO1J+Bj+FS277E6JUz9hAIlme7upXr15Vd1UeYBUyfh4AMnnIuzKcSoFCRznYCH2BruIjvaulDLQ/dSI9CxA2JrOpf4OBE13OhoF0L3fDmZ74LjyDZ76XKWZguSNjoYkwq/k4A5+8FUOF/JIPA8xkYfXI9/Ag4OOIov6Th+eeH00DPluFpWOpMEfWL4Dd3TYOkSvWc8m2S1uvUm616Nvcslv1RgGqhDhCHuiJOXWLtm3RF7eK9XKBFq2tYqOQwIvV7XKzXGpaBbDIZw9HKKKEkherlXrqZP3fqbJdLjdKrWYhkdJXMbInnqNiLYU1SnMpPa1QjBdiWlbKZtUMnUd09pzXtu1SpVKAHfLpKF+zzoQLNyFtFSu1zdSPFgvxVqmyWYBXC/geD/l4Dq+35nCrvoBb1VbJsjdT/q7QGAT+GOcBhgRMHaq1RZoNu1SvpUmm1WTnSA5pGvMka6VqAYrJjYSRpgcSJfF/osw+vv+VVj8vtvd//Ga2dIV12t3dBun/MY59KVi32902yEMlrynQIN2dKanR1QYw6MIPZDnHX+IrFFwjGySQpPxPcKnjwL/iri/jiA18zQNfz9iAIn9NQs/Ri12MmJ4g85KKsZmMmeaXyEZKhvAZga59OlYRG85MspXyJtlKRPDt3W39IA4C1kPNXksRU7oXCXYolTCV2iq/sgtg8L0pvxYR4ywlY9Q0RiBeoTKsaJXNTSAhI3Sl8CIWT5mW5BDyGz+MQ/MMK+xBTQm+ovU7GSu2kHftkxSt+BUGiafw4EvC4M00kB4yiiaoUSgJFBj6GJkUXlJ52sL1qZXTDKBgrk9xau3k4ZuQrY/vP7Anj8qomKKCz+lLBelwzWkgDI1DI6CMAsPcXNzrJb+7VSzdvXnXP+p22N7bk8P90xPWOdrv9c+O2/199ojOwrIrA6ng7/b3OVg64SFChY4XMk9o2EjxXUQNgZGmgaCNoPr9n389/UEe1vdvqBptrZU/jDVGWVhXnLKYOfF0rLiHZq7QnHk5kdqZSs21dFwzkMi8noelMT3iHOQ6p29et/tOGZYOuif7ZPix3TvbP18YVuFFLMx0Q8+JAmkmItCEe0Q9EORgbbF0iBtWUghkYM2LxRilcHyNYYZChNLzRz6V+DlPs87Cp3PRTlJhirGcM2MUNs5OLyjORbd/RJ/HiuZhjdqZZoYOzZym5DU1hzN9aI40+fWYJnZINSTecWrNZuHFCJVMWsYJueAmWhby6qHdUsPKOOlP2qzQ6X+YV4CuLo5J3zdWzW5VRs3ajteo4Y5tWfWdoc1HO+XmqFr3qm6t6npLsEoq6Dp5OCVZH37P3ydVXEkfHK3hXyKM9QmCBgAA"

describe("decodeItemBytes", () => {
  it("decodes ExtraAttributes from a gzip+NBT auction blob", async () => {
    const extra = await decodeItemBytes(FIXTURE_ITEM_BYTES)
    expect(extra).not.toBeNull()
    expect(extra!.id).toBe("POWER_WITHER_CHESTPLATE")
    expect(extra!.rarity_upgrades).toBe(1)
    expect(extra!.hot_potato_count).toBe(15)
    expect(extra!.upgrade_level).toBe(5)
    expect(extra!.modifier).toBe("ancient")
    expect(extra!.enchantments).toMatchObject({
      protection: 6,
      growth: 6,
      rejuvenate: 5,
      ultimate_legion: 3,
      true_protection: 1,
      ferocious_mana: 5,
    })
    expect(extra!.gems).toMatchObject({
      JASPER_0: "FINE",
      COMBAT_0: "FINE",
      COMBAT_0_gem: "JASPER",
      unlocked_slots: ["JASPER_0", "COMBAT_0"],
    })
  })

  it("returns null for garbage input instead of throwing", async () => {
    await expect(decodeItemBytes("not-valid-base64!!!")).resolves.toBeNull()
  })
})
