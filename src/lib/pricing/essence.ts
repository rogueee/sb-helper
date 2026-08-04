/**
 * Star / essence upgrade pricing.
 *
 * The items resource exposes `upgrade_costs` as an array indexed by star, where
 * each entry lists what that individual star costs. An item at star N has paid
 * for stars 0..N-1, so the total is the sum of that prefix.
 *
 * Most entries are essence, but the schema also allows item and coin costs
 * (some stars consume materials like Wither Blood), so all three are handled.
 */
import type { SkyblockItem, UpgradeCost } from "../hypixel"
import { unpricedNote, type BazaarPrices } from "./bazaar"

/**
 * Stars past the essence tiers are Master Stars, applied in order. The items
 * resource does not publish these, so the sequence is encoded here.
 */
const MASTER_STARS = [
  "FIRST_MASTER_STAR",
  "SECOND_MASTER_STAR",
  "THIRD_MASTER_STAR",
  "FOURTH_MASTER_STAR",
  "FIFTH_MASTER_STAR",
]

export interface EssenceLine {
  label: string
  productId?: string
  quantity: number
  unit: number | null
  total: number | null
  note?: string
}

export function essenceProductId(essenceType: string): string {
  return `ESSENCE_${essenceType.toUpperCase()}`
}

function priceCost(bz: BazaarPrices, cost: UpgradeCost): EssenceLine {
  if (cost.type === "COINS") {
    return { label: "Coins", quantity: 1, unit: cost.coins, total: cost.coins }
  }

  if (cost.type === "ESSENCE") {
    const productId = essenceProductId(cost.essence_type)
    const unit = bz.price(productId, "instabuy")
    return {
      label: `${titleCase(cost.essence_type)} Essence`,
      productId,
      quantity: cost.amount,
      unit,
      total: unit === null ? null : unit * cost.amount,
      note: unit === null ? unpricedNote(bz, productId) : undefined,
    }
  }

  const unit = bz.price(cost.item_id, "instabuy")
  return {
    label: prettyId(cost.item_id),
    productId: cost.item_id,
    quantity: cost.amount,
    unit,
    total: unit === null ? null : unit * cost.amount,
    note: unit === null ? unpricedNote(bz, cost.item_id) : undefined,
  }
}

/** Merges duplicate lines so five stars of Wither Essence read as one row. */
function mergeLines(lines: EssenceLine[]): EssenceLine[] {
  const merged = new Map<string, EssenceLine>()
  for (const line of lines) {
    const key = line.productId ?? line.label
    const prev = merged.get(key)
    if (!prev) {
      merged.set(key, { ...line })
      continue
    }
    prev.quantity += line.quantity
    prev.total = prev.unit === null ? null : prev.unit * prev.quantity
  }
  return [...merged.values()]
}

/**
 * Cost of taking `item` from 0 stars to `stars`.
 * Returns an empty list when the item has no upgrade path or is unstarred.
 */
export function priceStars(
  bz: BazaarPrices,
  item: SkyblockItem | undefined,
  stars: number,
): EssenceLine[] {
  if (!item?.upgrade_costs || stars <= 0) return []

  const applied = item.upgrade_costs.slice(0, stars)
  const lines = applied.flatMap((tier) => tier.map((cost) => priceCost(bz, cost)))

  // Stars beyond the published essence tiers are Master Stars, applied in
  // order. These are expensive, so omitting them would badly understate a
  // fully-starred item.
  for (let i = applied.length; i < stars; i++) {
    const masterIndex = i - applied.length
    const productId = MASTER_STARS[masterIndex]

    if (!productId) {
      lines.push({
        label: `${stars - i} further star${stars - i > 1 ? "s" : ""}`,
        quantity: stars - i,
        unit: null,
        total: null,
        note: "upgrade cost not published",
      })
      break
    }

    const unit = bz.price(productId, "instabuy")
    lines.push({
      label: prettyId(productId),
      productId,
      quantity: 1,
      unit,
      total: unit,
      note: unit === null ? unpricedNote(bz, productId) : undefined,
    })
  }

  return mergeLines(lines)
}

/** Cost of the essence spent converting a normal item into its dungeon variant. */
export function priceDungeonConversion(
  bz: BazaarPrices,
  item: SkyblockItem | undefined,
): EssenceLine | null {
  const conv = item?.dungeon_item_conversion_cost
  if (!conv) return null
  return priceCost(bz, { type: "ESSENCE", essence_type: conv.essence_type, amount: conv.amount })
}

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ")
}

export function prettyId(id: string): string {
  return titleCase(id)
}
