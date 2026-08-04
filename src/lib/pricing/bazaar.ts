/**
 * Price lookups over a Bazaar snapshot.
 *
 * Two directions matter and they are not interchangeable:
 *   instabuy  -> what you pay to acquire a component right now  (quick_status.buyPrice)
 *   instasell -> what you receive dumping an item right now     (quick_status.sellPrice)
 *
 * The craft calculator always sources components at instabuy. The compaction
 * calculator lets you pick, because the raw-vs-compacted verdict can flip
 * between instasell and patient sell-offer pricing.
 */
import type { BazaarQuickStatus, BazaarResponse } from "../hypixel"

export type PriceMode = "instabuy" | "instasell" | "sellOffer" | "buyOrder"

export class BazaarPrices {
  readonly lastUpdated: number

  constructor(private readonly data: BazaarResponse) {
    this.lastUpdated = data.lastUpdated
  }

  has(productId: string): boolean {
    return productId in this.data.products
  }

  /**
   * Returns null rather than 0 for an unknown product, so callers can render
   * "not priced" instead of silently understating a total.
   */
  price(productId: string, mode: PriceMode = "instabuy"): number | null {
    const q = this.data.products[productId]?.quick_status
    if (!q) return null

    switch (mode) {
      // Buying instantly consumes the cheapest sell offers.
      case "instabuy":
        return q.buyPrice > 0 ? q.buyPrice : null
      // Selling instantly fills into the highest buy orders.
      case "instasell":
        return q.sellPrice > 0 ? q.sellPrice : null
      // Placing your own sell offer means competing at the instabuy price.
      case "sellOffer":
        return q.buyPrice > 0 ? q.buyPrice : null
      // Placing your own buy order means competing at the instasell price.
      case "buyOrder":
        return q.sellPrice > 0 ? q.sellPrice : null
    }
  }

  productIds(): string[] {
    return Object.keys(this.data.products)
  }

  /**
   * Every product's order-book summary. The per-item `price` lookups above are
   * the right tool for pricing a known component; this is for whole-market
   * scans that need volume and order counts as well as price.
   */
  entries(): [string, BazaarQuickStatus][] {
    return Object.entries(this.data.products)
      .filter(([, p]) => p.quick_status)
      .map(([id, p]) => [id, p.quick_status])
  }

  /**
   * Why a price is unavailable. Plenty of products are listed on the Bazaar but
   * have a completely empty order book (intermediate enchant levels, mostly) —
   * telling the user "no sell offers" rather than "not sold on bazaar" is the
   * difference between a believable breakdown and one that looks broken.
   */
  unavailableReason(productId: string): "no-offers" | "absent" {
    return productId in this.data.products ? "no-offers" : "absent"
  }
}

/** Human-readable note explaining why a line could not be priced. */
export function unpricedNote(bz: BazaarPrices, productId: string): string {
  return bz.unavailableReason(productId) === "no-offers"
    ? "no sell offers"
    : "not sold on bazaar"
}
