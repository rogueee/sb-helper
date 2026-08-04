import type { BazaarResponse } from "../hypixel"
import { BazaarPrices } from "./bazaar"

/** Builds a BazaarPrices from a plain `{ productId: { buy, sell } }` map for tests. */
export function mockBazaar(prices: Record<string, { buy?: number; sell?: number }>): BazaarPrices {
  const products: BazaarResponse["products"] = {}
  for (const [id, p] of Object.entries(prices)) {
    products[id] = {
      product_id: id,
      quick_status: {
        productId: id,
        buyPrice: p.buy ?? 0,
        buyVolume: 0,
        buyMovingWeek: 0,
        buyOrders: 0,
        sellPrice: p.sell ?? 0,
        sellVolume: 0,
        sellMovingWeek: 0,
        sellOrders: 0,
      },
    }
  }
  return new BazaarPrices({ success: true, lastUpdated: 0, products })
}
