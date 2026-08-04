/**
 * Bazaar order flipping.
 *
 * The play is to buy with a *buy order* rather than instabuying, and sell with a
 * *sell offer* rather than instaselling — capturing the whole gap between the
 * two books instead of paying it. So the margin is:
 *
 *     buyPrice (top sell offer)  -  sellPrice (top buy order)
 *
 * which is exactly the spread an instabuy-then-instasell round trip would lose.
 *
 * The catch is that both orders have to actually fill, and that is where most
 * naive bazaar-flip lists go wrong: the largest percentage spreads belong to
 * products nobody trades, where the order book is two stale orders far apart.
 * Weekly volume is therefore a first-class part of the ranking, not a footnote.
 */
import type { BazaarPrices } from "./pricing/bazaar"
import { bazaarNetProceeds, type BazaarTaxTier } from "./fees"

export interface BazaarFlip {
  productId: string
  name: string
  /** What you pay per unit with a buy order (the top buy order price). */
  buyOrderPrice: number
  /** What you receive per unit with a sell offer, before tax. */
  sellOfferPrice: number
  /** Per-unit profit after bazaar tax on the sale. */
  margin: number
  /** margin as a fraction of the buy price. */
  marginPct: number
  /** Units bought per week across the whole market. */
  buyVolumeWeek: number
  /** Units sold per week across the whole market. */
  sellVolumeWeek: number
  /**
   * The side that fills slowest, per hour. Both legs must complete, so the
   * slower book is what actually paces the flip.
   */
  unitsPerHour: number
  /** margin x unitsPerHour — the whole market's flow, not a personal ceiling. */
  marketProfitPerHour: number
  /** Standing orders on each side, a sanity check on how real the book is. */
  buyOrders: number
  sellOrders: number
}

export interface BazaarFlipOptions {
  tax?: BazaarTaxTier
  /** Minimum units traded per week on *both* sides. */
  minWeeklyVolume?: number
  /** Minimum per-unit margin in coins. */
  minMargin?: number
  /** Ignore products whose margin exceeds this share of the buy price. */
  maxMarginPct?: number
}

/**
 * A spread wider than this is nearly always a broken book — a single lowball
 * buy order sitting under a single moonshot sell offer — rather than an
 * opportunity. Left adjustable because the threshold is a judgement call.
 */
const DEFAULT_MAX_MARGIN_PCT = 1

const HOURS_PER_WEEK = 168

export function analyseBazaarFlips(
  bazaar: BazaarPrices,
  names: Map<string, string>,
  opts: BazaarFlipOptions = {},
): BazaarFlip[] {
  const {
    tax = "base",
    minWeeklyVolume = 10_000,
    minMargin = 0,
    maxMarginPct = DEFAULT_MAX_MARGIN_PCT,
  } = opts

  const flips: BazaarFlip[] = []

  for (const [productId, q] of bazaar.entries()) {
    const sellOfferPrice = q.buyPrice
    const buyOrderPrice = q.sellPrice
    // An empty side of the book prices at 0, which would read as an infinite
    // margin. Both sides must be live for the round trip to mean anything.
    if (!(sellOfferPrice > 0) || !(buyOrderPrice > 0)) continue

    const margin = bazaarNetProceeds(sellOfferPrice, tax) - buyOrderPrice
    if (margin <= 0 || margin < minMargin) continue

    const marginPct = margin / buyOrderPrice
    if (marginPct > maxMarginPct) continue

    if (q.buyMovingWeek < minWeeklyVolume || q.sellMovingWeek < minWeeklyVolume) continue

    const unitsPerHour = Math.min(q.buyMovingWeek, q.sellMovingWeek) / HOURS_PER_WEEK

    flips.push({
      productId,
      name: names.get(productId) ?? prettifyProductId(productId),
      buyOrderPrice,
      sellOfferPrice,
      margin,
      marginPct,
      buyVolumeWeek: q.buyMovingWeek,
      sellVolumeWeek: q.sellMovingWeek,
      unitsPerHour,
      marketProfitPerHour: margin * unitsPerHour,
      buyOrders: q.buyOrders,
      sellOrders: q.sellOrders,
    })
  }

  return flips
}

/**
 * Bazaar product ids are mostly item ids, but enchanted books carry their level
 * in the id and are not in the items resource under that name.
 */
export function prettifyProductId(id: string): string {
  const book = id.match(/^ENCHANTMENT_(.+)_(\d+)$/)
  const base = book ? book[1] : id
  const words = base
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ")
  return book ? `${words} ${book[2]}` : words
}
