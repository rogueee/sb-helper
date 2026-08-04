/**
 * Sale taxes.
 *
 * Flip tools are worthless if they quote gross spreads: the tax is frequently
 * larger than the margin on a thin bazaar flip, so a "profit" computed before
 * fees can be a loss. Every figure this app calls profit is net of these.
 *
 * Rates from the SkyBlock wiki (Auction House, Bazaar):
 *   https://hypixelskyblock.minecraft.wiki/w/Auction_House
 *   https://hypixelskyblock.minecraft.wiki/w/Bazaar
 */

/* -------------------------------------------------------------------------- */
/* Auction house                                                              */
/* -------------------------------------------------------------------------- */

/** BIN listing fee, charged on the asking price and tiered by it. */
function binListingFeeRate(price: number): number {
  if (price > 100_000_000) return 0.025
  if (price > 10_000_000) return 0.02
  return 0.01
}

/**
 * What a BIN sale actually pays out.
 *
 * Two separate charges apply: the listing fee when the auction is created, and
 * a collection tax of up to 1% when the coins are claimed. The collection tax
 * only applies above 1m and is capped so it can never drag a claim below 1m,
 * which is why it is a `min` rather than a flat percentage.
 */
export function auctionNetProceeds(price: number): number {
  if (price <= 0) return 0

  const listingFee = price * binListingFeeRate(price)
  const collectionTax = price > 1_000_000 ? Math.min(price * 0.01, price - 1_000_000) : 0

  return price - listingFee - collectionTax
}

/** Total tax on a BIN sale, as coins. */
export function auctionTax(price: number): number {
  return price - auctionNetProceeds(price)
}

/* -------------------------------------------------------------------------- */
/* Bazaar                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Bazaar sale tax. The base rate is 1.25%; claiming manually saves a little,
 * and the Bazaar Flipper perk at the Community Center takes it to 1%.
 *
 * This is user-selectable because on a 0.5% margin the difference between 1.25%
 * and 1% decides whether the flip is profitable at all.
 */
export const BAZAAR_TAX_RATES = {
  base: 0.0125,
  manualClaim: 0.01125,
  flipperMaxed: 0.01,
} as const

export type BazaarTaxTier = keyof typeof BAZAAR_TAX_RATES

export const BAZAAR_TAX_LABELS: Record<BazaarTaxTier, string> = {
  base: "1.25% (default)",
  manualClaim: "1.125% (manual claim)",
  flipperMaxed: "1% (Bazaar Flipper maxed)",
}

/** What a bazaar sale pays out after tax. Buying is untaxed. */
export function bazaarNetProceeds(price: number, tier: BazaarTaxTier = "base"): number {
  return price <= 0 ? 0 : price * (1 - BAZAAR_TAX_RATES[tier])
}
