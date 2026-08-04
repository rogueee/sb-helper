/**
 * Filter and sort controls for the craft-vs-buy listing table.
 *
 * Options are derived from the current result set rather than hardcoded — there
 * is no point offering a "Mythic" chip when no listing is mythic, and star
 * counts vary wildly by item. Chips that would match nothing never appear.
 */
import { Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/Chip"
import { SortChips, type SortOption } from "@/components/SortChips"
import { cn } from "@/lib/utils"
import { rarityColorClass, rarityLabel } from "@/lib/rarity"

import {
  EMPTY_FILTERS,
  hasActiveFilters,
  type ListingFilterState,
  type SortChain,
  type SortKey,
} from "@/lib/listings"

// Ascending across the board here: the best deal is the most negative spread,
// and the interesting listing is the cheapest one.
const SORT_OPTIONS: SortOption<SortKey>[] = [
  { key: "spread", label: "Spread" },
  { key: "price", label: "Price" },
  { key: "craftCost", label: "Craft cost" },
]

export function ListingFilters({
  availableRarities,
  availableStars,
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  shown,
  total,
  busy = false,
}: {
  availableRarities: string[]
  availableStars: number[]
  filters: ListingFilterState
  onFiltersChange: (f: ListingFilterState) => void
  sort: SortChain
  onSortChange: (s: SortChain) => void
  shown: number
  total: number
  /** A background re-price is running; the controls stay usable regardless. */
  busy?: boolean
}) {
  function toggleRarity(tier: string) {
    const next = new Set(filters.rarities)
    if (!next.delete(tier)) next.add(tier)
    onFiltersChange({ ...filters, rarities: next })
  }

  function toggleStar(star: number) {
    const next = new Set(filters.stars)
    if (!next.delete(star)) next.add(star)
    onFiltersChange({ ...filters, stars: next })
  }

  const active = hasActiveFilters(filters)

  return (
    <div className="space-y-2.5 rounded-lg border bg-muted/20 px-4 py-3">
      {availableRarities.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-14 shrink-0 text-xs text-muted-foreground">Rarity</span>
          {availableRarities.map((tier) => (
            <Chip
              key={tier}
              active={filters.rarities.has(tier)}
              onClick={() => toggleRarity(tier)}
              className={cn(filters.rarities.has(tier) && rarityColorClass(tier))}
            >
              {rarityLabel(tier)}
            </Chip>
          ))}
        </div>
      )}

      {availableStars.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-14 shrink-0 text-xs text-muted-foreground">Stars</span>
          {availableStars.map((star) => (
            <Chip key={star} active={filters.stars.has(star)} onClick={() => toggleStar(star)}>
              {star === 0 ? "None" : `${star}★`}
            </Chip>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-14 shrink-0 text-xs text-muted-foreground">Sort</span>
        <SortChips options={SORT_OPTIONS} sort={sort} onChange={onSortChange} />

        <div className="ml-auto flex items-center gap-2">
          {/*
            Filtering and sorting act on already-decoded rows, so a background
            re-price never needs to block them — it just gets a quiet spinner.
          */}
          {busy && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
          <span className="text-xs tabular text-muted-foreground">
            {active ? `${shown} of ${total}` : `${total} listings`}
          </span>
          {active && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => onFiltersChange(EMPTY_FILTERS)}
            >
              <X className="size-3" /> Clear
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
