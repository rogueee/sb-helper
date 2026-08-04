import { useEffect, useMemo, useState } from "react"
import { ChevronDown, ExternalLink, Loader2 } from "lucide-react"
import { ItemSearch, type SearchableItem } from "@/components/ItemSearch"
import { CostBreakdown } from "@/components/CostBreakdown"
import { Badge } from "@/components/ui/badge"
import { EmptyIndex, IndexStatus, RestoringIndex, useAuctionIndex } from "@/components/AuctionIndex"
import { useBazaar, useItemMap } from "@/lib/queries"
import { findListings, type DecodedListing } from "@/lib/auctionIndex"
import { valuate, type Valuation } from "@/lib/pricing/valuate"
import type { BazaarPrices } from "@/lib/pricing/bazaar"
import { ListingFilters } from "@/components/ListingFilters"
import {
  applyFiltersAndSort,
  DEFAULT_SORT,
  EMPTY_FILTERS,
  type ListingFilterState,
  type PricedListing,
  type SortChain,
} from "@/lib/listings"
import { rarityColorClass, rarityLabel, sortRarities } from "@/lib/rarity"
import { formatCoins, formatExact, formatSigned } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * Cheapest way to obtain the unmodified item: its Bazaar price if it trades
 * there, otherwise the cheapest listing carrying no modifiers at all.
 *
 * Without this the comparison is meaningless — a clean listing would show a
 * component total of zero and appear to be pure profit.
 */
function findBaseCost(
  bazaar: BazaarPrices,
  itemId: string,
  priced: { listing: DecodedListing; valuation: Valuation }[],
): number | null {
  const bazaarPrice = bazaar.price(itemId, "instabuy")

  let cheapestClean: number | null = null
  for (const p of priced) {
    if (p.valuation.lines.length > 0) continue
    if (cheapestClean === null || p.listing.price < cheapestClean) {
      cheapestClean = p.listing.price
    }
  }

  if (bazaarPrice === null) return cheapestClean
  if (cheapestClean === null) return bazaarPrice
  return Math.min(bazaarPrice, cheapestClean)
}

export function CraftCalculator() {
  const { data: bazaar } = useBazaar()
  const { data: itemMap, items } = useItemMap()

  const { index, progress, error: indexError, load: runSweep, restoring } = useAuctionIndex()
  const [selected, setSelected] = useState<SearchableItem | null>(null)
  const [results, setResults] = useState<PricedListing[] | null>(null)
  const [baseCost, setBaseCost] = useState<number | null>(null)
  const [filters, setFilters] = useState<ListingFilterState>(EMPTY_FILTERS)
  const [sort, setSort] = useState<SortChain>(DEFAULT_SORT)
  const [searching, setSearching] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const searchable = useMemo<SearchableItem[]>(
    () => (items ?? []).map((i) => ({ id: i.id, name: i.name })),
    [items],
  )

  // Re-price whenever the selection, the index, or the Bazaar snapshot changes.
  useEffect(() => {
    if (!selected || !index || !bazaar || !itemMap) return

    let cancelled = false
    setSearching(true)
    setExpanded(null)

    findListings(index, selected.id, selected.name)
      .then((listings) => {
        if (cancelled) return

        const valued = listings
          .map((listing) => ({
            listing,
            valuation: valuate(bazaar, listing.extra, itemMap.get(selected.id)),
          }))
          // Pets price on level and xp, which this tool does not model.
          .filter((p) => !p.valuation.isPet)

        // The base has to be priced across the whole result set before any
        // single listing's craft cost means anything.
        const base = findBaseCost(bazaar, selected.id, valued)
        setBaseCost(base)

        setResults(
          valued.map((p) => {
            const craftCost = base === null ? null : base + p.valuation.componentTotal
            const extra = p.listing.extra
            return {
              ...p,
              craftCost,
              spread: craftCost === null ? null : p.listing.price - craftCost,
              stars: Math.max(
                typeof extra.upgrade_level === "number" ? extra.upgrade_level : 0,
                typeof extra.dungeon_item_level === "number" ? extra.dungeon_item_level : 0,
              ),
              tier: p.listing.tier,
            }
          }),
        )
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Search failed")
      })
      .finally(() => !cancelled && setSearching(false))

    return () => {
      cancelled = true
    }
  }, [selected, index, bazaar, itemMap])

  // A new search starts clean: stale chips from the previous item would hide
  // everything, and its results must not linger under the new item's name while
  // the new ones decode.
  useEffect(() => {
    setFilters(EMPTY_FILTERS)
    setResults(null)
  }, [selected])

  const visible = useMemo(
    () => (results ? applyFiltersAndSort(results, filters, sort) : null),
    [results, filters, sort],
  )

  const availableRarities = useMemo(
    () => (results ? sortRarities(results.map((p) => p.tier)) : []),
    [results],
  )
  const availableStars = useMemo(
    () => (results ? [...new Set(results.map((p) => p.stars))].sort((a, b) => a - b) : []),
    [results],
  )

  // The summary describes the cheapest listing overall, independent of sort
  // order, so it stays a stable reference point while you re-sort.
  const cheapest = useMemo(
    () =>
      visible && visible.length > 0
        ? visible.reduce((min, p) => (p.listing.price < min.listing.price ? p : min))
        : undefined,
    [visible],
  )

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Craft vs buy</h1>
          <p className="text-sm text-muted-foreground">
            Compare live auction listings against what their components cost at bazaar instabuy.
          </p>
        </div>
        <IndexStatus index={index} progress={progress} onRefresh={runSweep} />
      </div>

      {(error ?? indexError) && <p className="text-sm text-loss">{error ?? indexError}</p>}

      {restoring && !index ? (
        <RestoringIndex />
      ) : !index && !progress ? (
        <EmptyIndex onLoad={runSweep} />
      ) : (
        <>
          <ItemSearch
            items={searchable}
            onSelect={setSelected}
            placeholder="Search for an item — try Hyperion"
            autoFocus
          />

          {/*
            Only take over the view on a first search. The Bazaar refetches on a
            timer, which re-prices everything — unmounting the table for that
            would yank the filter controls out from under the cursor and reset
            scroll every minute. Re-pricing dims the existing results instead.
          */}
          {searching && !results && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Decoding listings…
            </p>
          )}

          {selected && results && visible && (
            <div className="space-y-6">
              {results.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No BIN listings found for {selected.name}.
                </p>
              ) : (
                <>
                  <SummaryRow
                    item={selected}
                    cheapest={cheapest}
                    count={visible.length}
                    baseCost={baseCost}
                  />

                  <ListingFilters
                    availableRarities={availableRarities}
                    availableStars={availableStars}
                    filters={filters}
                    onFiltersChange={setFilters}
                    sort={sort}
                    onSortChange={setSort}
                    shown={visible.length}
                    total={results.length}
                    busy={searching}
                  />

                  {visible.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No listings match these filters.
                    </p>
                  ) : (
                  <div className="rounded-lg border">
                    <div className="grid grid-cols-[1fr_auto_auto_auto_2rem] items-center gap-4 border-b px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <span>Listing</span>
                      <span className="text-right">Price</span>
                      <span className="text-right">Craft cost</span>
                      <span className="text-right">Spread</span>
                      <span />
                    </div>
                    {visible.map((p) => (
                      <ListingRow
                        key={p.listing.uuid}
                        priced={p}
                        expanded={expanded === p.listing.uuid}
                        onToggle={() =>
                          setExpanded(expanded === p.listing.uuid ? null : p.listing.uuid)
                        }
                      />
                    ))}
                  </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SummaryRow({
  item,
  cheapest,
  count,
  baseCost,
}: {
  item: SearchableItem
  cheapest: PricedListing | undefined
  count: number
  baseCost: number | null
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
      <div>
        <div className="text-lg font-medium">{item.name}</div>
        <div className="text-xs text-muted-foreground">
          {count} BIN listing{count === 1 ? "" : "s"}
        </div>
      </div>
      <Stat label="Clean base" value={formatCoins(baseCost)} />
      {cheapest && (
        <>
          <Stat label="Cheapest listing" value={formatCoins(cheapest.listing.price)} />
          <Stat label="Cost to build it" value={formatCoins(cheapest.craftCost)} />
          <Stat
            label="Spread"
            value={formatSigned(cheapest.spread)}
            tone={
              cheapest.spread === null ? undefined : cheapest.spread < 0 ? "gain" : "loss"
            }
          />
        </>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: "gain" | "loss"
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "text-lg font-medium tabular",
          tone === "gain" && "text-gain",
          tone === "loss" && "text-loss",
        )}
      >
        {value}
      </div>
    </div>
  )
}

/**
 * Link out to everything else the seller has up.
 *
 * Hypixel has no web auction house, so this goes to sky.coflnet.com, which
 * indexes live auctions by player. It sits inside the expanded panel rather
 * than on the row because the row is itself a button, and a link nested in a
 * button is both invalid markup and impossible to click without toggling.
 */
function SellerLink({ auctioneer }: { auctioneer: string | undefined }) {
  if (!auctioneer) return null

  return (
    <a
      href={`https://sky.coflnet.com/player/${auctioneer}`}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
    >
      <ExternalLink className="size-3" />
      Seller's other listings
    </a>
  )
}

function ListingRow({
  priced,
  expanded,
  onToggle,
}: {
  priced: PricedListing
  expanded: boolean
  onToggle: () => void
}) {
  const { listing, valuation, craftCost, spread } = priced
  // A negative spread means the listing costs less than rebuilding it — a buy.
  const isDeal = spread !== null && spread < 0

  return (
    <div className="border-b last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="grid w-full grid-cols-[1fr_auto_auto_auto_2rem] items-center gap-4 px-4 py-2.5 text-left text-sm hover:bg-accent/50"
      >
        <span className="flex items-center gap-2 truncate">
          {/*
            The item name carries the rarity colour rather than a separate
            swatch — it is how the AH itself presents rarity, so it reads
            without a legend.
          */}
          <span className={cn("truncate font-medium", rarityColorClass(priced.tier))}>
            {listing.name}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground" title={rarityLabel(priced.tier)}>
            {rarityLabel(priced.tier)}
          </span>
          {valuation.unpriced.length > 0 && (
            <Badge variant="outline" className="shrink-0">
              +{valuation.unpriced.length} unpriced
            </Badge>
          )}
        </span>
        <span className="text-right tabular" title={formatExact(listing.price)}>
          {formatCoins(listing.price)}
        </span>
        <span
          className="text-right tabular text-muted-foreground"
          title={formatExact(craftCost)}
        >
          {formatCoins(craftCost)}
        </span>
        <span
          className={cn(
            "text-right tabular",
            spread === null ? "text-muted-foreground" : isDeal ? "text-gain" : "text-loss",
          )}
          title={formatExact(spread)}
        >
          {formatSigned(spread)}
        </span>
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded && (
        <div className="border-t bg-muted/30 px-4 pb-4">
          <CostBreakdown valuation={valuation} />
          <SellerLink auctioneer={listing.auctioneer} />
        </div>
      )}
    </div>
  )
}
