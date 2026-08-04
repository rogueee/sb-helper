/**
 * Enchantment book pricing.
 *
 * NBT stores enchants as `{ protection: 6 }`; the Bazaar sells them as
 * `ENCHANTMENT_PROTECTION_6`. Buying the top-level book outright is often *not*
 * the cheapest route, because two books of level N combine in the anvil into one
 * of level N+1. Whenever the lower tier is more than half the price of the
 * higher one, buying two of it and combining wins — a real and frequently large
 * saving on things like Protection VII or Growth VI.
 *
 * So the cost of level L is solved bottom-up:
 *     cost(L) = min( bazaarPrice(L), 2 x cost(L-1) )
 */
import { unpricedNote, type BazaarPrices } from "./bazaar"

export interface EnchantCost {
  enchant: string
  level: number
  productId: string
  /** Total coins for this enchant at this level, or null if unpriceable. */
  total: number | null
  /** Level of book actually purchased, when combining beats buying outright. */
  boughtLevel?: number
  /** How many of `boughtLevel` are needed. */
  boughtQty?: number
  /** True when the level was extrapolated by combining rather than quoted directly. */
  estimated?: boolean
  note?: string
}

export function enchantProductId(enchant: string, level: number): string {
  return `ENCHANTMENT_${enchant.toUpperCase()}_${level}`
}

/**
 * Ultimate enchants are namespaced `ultimate_` in NBT and on the Bazaar, but
 * the game shows them as light purple text without that word — nobody calls it
 * "Ultimate Wisdom V". The prefix is a data artifact, so it is dropped from the
 * label and the colour carries the distinction instead.
 */
const ULTIMATE_PREFIX = "ultimate_"

export function isUltimateEnchant(enchant: string): boolean {
  return enchant.toLowerCase().startsWith(ULTIMATE_PREFIX)
}

/** `ultimate_wisdom` -> `wisdom`; anything else is returned unchanged. */
export function enchantBaseName(enchant: string): string {
  return isUltimateEnchant(enchant) ? enchant.slice(ULTIMATE_PREFIX.length) : enchant
}

/**
 * Enchants that are not bought at level, but level themselves up through use.
 *
 * Hecatomb is applied from a level 1 book and climbs to X by completing dungeon
 * runs — there is no Hecatomb X book to buy and no combining involved. Charging
 * anything beyond the level 1 book would invent a cost that no player ever pays,
 * and since the craft calculator subtracts craft cost from the listing price,
 * that inflation would manufacture deals that are not there.
 *
 * Other enchants share the mechanic (Champion, Compact, Cultivating, Expertise,
 * Toxophilite); they are deliberately not listed until confirmed, since wrongly
 * flattening a genuinely tiered enchant understates craft cost.
 */
const LEVELING_ENCHANTS = new Set(["hecatomb"])

/**
 * Cheapest way to obtain one book of `enchant` at `level`.
 *
 * Only considers combining when the enchant is known to the Bazaar at some
 * level; otherwise there is no evidence it is a tradeable book at all and we
 * report it as unpriced rather than inventing a number.
 */
export function priceEnchant(bz: BazaarPrices, enchant: string, level: number): EnchantCost {
  const productId = enchantProductId(enchant, level)

  // Self-levelling enchants cost one level 1 book no matter what level they
  // reached, so the combine walk below does not apply to them at all.
  if (LEVELING_ENCHANTS.has(enchant.toLowerCase())) {
    const baseId = enchantProductId(enchant, 1)
    const unit = bz.price(baseId, "instabuy")
    return {
      enchant,
      level,
      productId: baseId,
      total: unit,
      boughtLevel: 1,
      boughtQty: 1,
      note:
        unit === null
          ? unpricedNote(bz, baseId)
          : level > 1
            ? "levels up in use — lvl 1 book only"
            : undefined,
    }
  }

  let best: { total: number; boughtLevel: number; boughtQty: number } | null = null
  /** The enchant is a known Bazaar product, even if nothing is currently offered. */
  let knownProduct = false

  // Walk down from the target level, doubling the quantity for each step down.
  for (let lvl = level, qty = 1; lvl >= 1; lvl--, qty *= 2) {
    const levelId = enchantProductId(enchant, lvl)
    if (bz.has(levelId)) knownProduct = true

    const unit = bz.price(levelId, "instabuy")
    if (unit !== null) {
      const total = unit * qty
      if (!best || total < best.total) best = { total, boughtLevel: lvl, boughtQty: qty }
    }

    // Past ~2^6 books the combine path stops being realistic to execute.
    if (qty >= 64) break
  }

  if (!best) {
    // Many enchants only have liquidity at their top level — nobody trades
    // Critical 1-5 when Critical 6 is what everyone buys. Pricing those from the
    // level above was tried and rejected: it charges a Magmarizer 6 book for an
    // item that only has Magmarizer 5, which inflated craft costs badly enough
    // to invent deals that were not there. These are excluded from the total
    // instead, the same way auction-only components like runes are.
    return {
      enchant,
      level,
      productId,
      total: null,
      // Distinguishing these matters: an empty order book is a temporary market
      // condition, whereas an unknown product means we cannot price it at all.
      note: knownProduct ? "no sell offers at any level" : "not sold on bazaar",
    }
  }

  const directlyQuoted = best.boughtLevel === level
  return {
    enchant,
    level,
    productId,
    total: best.total,
    boughtLevel: best.boughtLevel,
    boughtQty: best.boughtQty,
    estimated: !directlyQuoted && bz.price(productId, "instabuy") === null,
    note: directlyQuoted
      ? undefined
      : `${best.boughtQty}x lvl ${best.boughtLevel} combined`,
  }
}

export function priceEnchantments(
  bz: BazaarPrices,
  enchantments: Record<string, number>,
): EnchantCost[] {
  return Object.entries(enchantments)
    .map(([enchant, level]) => priceEnchant(bz, enchant, level))
    .sort((a, b) => (b.total ?? 0) - (a.total ?? 0))
}
