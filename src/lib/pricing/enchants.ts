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
import type { BazaarPrices } from "./bazaar"

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
  /**
   * True when a *higher* level was priced because the exact one has no market.
   * The resulting item is better than the listing, so this is an upper bound.
   */
  substituted?: boolean
  note?: string
}

/** How many levels above the target to consider when the exact level has no market. */
const MAX_SUBSTITUTE_STEPS = 3

export function enchantProductId(enchant: string, level: number): string {
  return `ENCHANTMENT_${enchant.toUpperCase()}_${level}`
}

/**
 * Cheapest way to obtain one book of `enchant` at `level`.
 *
 * Only considers combining when the enchant is known to the Bazaar at some
 * level; otherwise there is no evidence it is a tradeable book at all and we
 * report it as unpriced rather than inventing a number.
 */
export function priceEnchant(bz: BazaarPrices, enchant: string, level: number): EnchantCost {
  const productId = enchantProductId(enchant, level)

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
    // Critical 1-5 when Critical 6 is what everyone buys. You cannot split a
    // higher book back down, so the realistic way to obtain the enchant is to
    // buy the next level up. That overshoots the listing's exact config, so it
    // is reported as a substitution rather than folded in silently.
    for (let lvl = level + 1; lvl <= level + MAX_SUBSTITUTE_STEPS; lvl++) {
      const substituteId = enchantProductId(enchant, lvl)
      const unit = bz.price(substituteId, "instabuy")
      if (unit === null) continue
      return {
        enchant,
        level,
        productId,
        total: unit,
        boughtLevel: lvl,
        boughtQty: 1,
        substituted: true,
        note: `lvl ${lvl} — no lvl ${level} market`,
      }
    }

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
