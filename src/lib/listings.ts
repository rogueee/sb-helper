/**
 * The priced-listing shape and the filter/sort pipeline applied to it.
 *
 * Kept out of the route component so the ordering rules — which are fiddly
 * around unpriceable rows — can be tested directly.
 */
import type { DecodedListing } from "./auctionIndex"
import type { Valuation } from "./pricing/valuate"
import { multiSort, toggleSortRule, type SortChainOf, type SortRuleOf } from "./multiSort"

export interface PricedListing {
  listing: DecodedListing
  valuation: Valuation
  /** Base item + every modifier. Null when no clean base could be priced. */
  craftCost: number | null
  /**
   * listing price - craftCost. Negative means the listing is cheaper than
   * assembling the same thing yourself, i.e. worth buying.
   */
  spread: number | null
  /** Star level, hoisted out of NBT so filtering and sorting stay cheap. */
  stars: number
  /**
   * Displayed rarity, which is the recombobulated tier when one was applied —
   * the auction's own `tier` already accounts for that, so it matches what a
   * player sees in the AH.
   */
  tier: string
}

export type SortKey = "price" | "craftCost" | "spread"
export type SortRule = SortRuleOf<SortKey>
export type SortChain = SortChainOf<SortKey>

export const DEFAULT_SORT: SortChain = [{ key: "price", direction: "asc" }]

/** Chip click semantics — see `toggleSortRule`. */
export const toggleSort = toggleSortRule<SortKey>

export interface ListingFilterState {
  /** Empty means "no rarity filter"; otherwise an allow-list of tiers. */
  rarities: Set<string>
  /** Empty means "no star filter"; otherwise an allow-list of star counts. */
  stars: Set<number>
}

export const EMPTY_FILTERS: ListingFilterState = { rarities: new Set(), stars: new Set() }

export function hasActiveFilters(f: ListingFilterState): boolean {
  return f.rarities.size > 0 || f.stars.size > 0
}

function sortValue(p: PricedListing, key: SortKey): number | null {
  return key === "price" ? p.listing.price : p[key]
}

/** Applies the rarity/star filters, then orders by the sort keys. */
export function applyFiltersAndSort(
  results: PricedListing[],
  filters: ListingFilterState,
  sort: SortChain,
): PricedListing[] {
  const filtered = results.filter((p) => {
    if (filters.rarities.size > 0 && !filters.rarities.has(p.tier)) return false
    if (filters.stars.size > 0 && !filters.stars.has(p.stars)) return false
    return true
  })

  return multiSort(filtered, sort, sortValue)
}
