import { useEffect, useMemo, useState } from "react"
import { Check, ChevronDown, Clock, Copy, Loader2, RefreshCw, X } from "lucide-react"
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
  type PriceRange,
  type PricedListing,
  type SortChain,
} from "@/lib/listings"
import { rarityColorClass, rarityLabel, sortRarities } from "@/lib/rarity"
import { formatCoins, formatExact, formatRelativeTime, formatSigned } from "@/lib/format"
import { resolvePlayerName } from "@/lib/mojang"
import { useLocalStorage } from "@/lib/useLocalStorage"
import { cn, onActivateKey } from "@/lib/utils"

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

interface HistoryEntry {
  id: string
  name: string
  searchedAt: number
}

/** Most-recent-first, one entry per item, capped so the card grid stays a glance. */
const MAX_HISTORY = 12

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
  const [history, setHistory] = useLocalStorage<HistoryEntry[]>("craftvsbuy:history", [])

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

  // Every completed selection joins the history, most recent first. Re-picking
  // an item already in it just bumps it back to the front rather than
  // duplicating the card.
  useEffect(() => {
    if (!selected) return
    setHistory((prev) => {
      const rest = prev.filter((h) => h.id !== selected.id)
      return [{ id: selected.id, name: selected.name, searchedAt: Date.now() }, ...rest].slice(
        0,
        MAX_HISTORY,
      )
    })
  }, [selected, setHistory])

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
  // Bounds for the price slider come from the whole result set, not the
  // filtered view — otherwise narrowing the range would shrink the range
  // control's own span.
  const priceBounds = useMemo<PriceRange | null>(() => {
    if (!results || results.length === 0) return null
    let min = Infinity
    let max = -Infinity
    for (const p of results) {
      if (p.listing.price < min) min = p.listing.price
      if (p.listing.price > max) max = p.listing.price
    }
    return { min, max }
  }, [results])

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

          {history.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Recent searches
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {history.map((entry) => (
                  <HistoryCard
                    key={entry.id}
                    entry={entry}
                    active={selected?.id === entry.id}
                    onOpen={() => setSelected({ id: entry.id, name: entry.name })}
                    onRemove={() => setHistory((prev) => prev.filter((h) => h.id !== entry.id))}
                  />
                ))}
              </div>
            </section>
          )}

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
                    priceBounds={priceBounds}
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
                    <div className="overflow-x-auto rounded-lg border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            <th className="px-4 py-2 text-left font-medium">Listing</th>
                            <th className="px-2 py-2 text-right font-medium">Price</th>
                            <th className="px-2 py-2 text-right font-medium">Craft cost</th>
                            <th className="px-2 py-2 text-right font-medium">Spread</th>
                            <th className="w-8 px-4 py-2" />
                          </tr>
                        </thead>
                        <tbody>
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
                        </tbody>
                      </table>
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

function HistoryCard({
  entry,
  active,
  onOpen,
  onRemove,
}: {
  entry: HistoryEntry
  active: boolean
  onOpen: () => void
  onRemove: () => void
}) {
  return (
    <div
      className={cn(
        "group relative rounded-lg border p-4 transition-colors",
        active && "border-foreground/40 bg-accent/40",
      )}
    >
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${entry.name} from history`}
        className="absolute right-2 top-2 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
      >
        <X className="size-3.5" />
      </button>

      <button type="button" onClick={onOpen} className="w-full text-left">
        <div className="truncate pr-6 text-sm font-medium">{entry.name}</div>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="size-3" />
          {formatRelativeTime(entry.searchedAt)}
        </div>
      </button>
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
 * Copy an in-game `/ah <name>` command for the seller.
 *
 * Hypixel has no web auction house and its API only ever gives up the seller's
 * player UUID, never a name — but `/ah` takes a name. Resolution happens on
 * expand rather than for every row, since most rows are never opened.
 *
 * A failed lookup stays retryable: the proxies are third-party and a miss is
 * usually transient, so the button turns into a retry rather than a dead end.
 */
function SellerCommand({ auctioneer }: { auctioneer: string | undefined }) {
  const [name, setName] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!auctioneer) return
    let cancelled = false
    setName(null)
    setFailed(false)

    resolvePlayerName(auctioneer).then((resolved) => {
      if (cancelled) return
      if (resolved) setName(resolved)
      else setFailed(true)
    })

    return () => {
      cancelled = true
    }
  }, [auctioneer, attempt])

  if (!auctioneer) return null

  const command = name ? `/ah ${name}` : null

  async function copy() {
    if (!command) {
      if (failed) setAttempt((n) => n + 1)
      return
    }
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard permission denied — nothing more to offer here.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      disabled={!command && !failed}
      title={
        command
          ? "Copy — paste in-game to view this seller's listings"
          : failed
            ? "Look up this seller's name again"
            : undefined
      }
      className="mt-3 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-60"
    >
      {copied ? (
        <Check className="size-3" />
      ) : failed ? (
        <RefreshCw className="size-3" />
      ) : (
        <Copy className="size-3" />
      )}
      {command ?? (failed ? "Seller lookup failed — retry" : "Resolving seller…")}
    </button>
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
    <>
      <tr
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={onActivateKey(onToggle)}
        className="cursor-pointer border-b text-sm hover:bg-accent/50"
      >
        <td className="w-full max-w-0 px-4 py-2.5">
          <span className="flex items-center gap-2 truncate">
            {/*
              The item name carries the rarity colour rather than a separate
              swatch — it is how the AH itself presents rarity, so it reads
              without a legend.
            */}
            <span className={cn("truncate font-medium", rarityColorClass(priced.tier))}>
              {listing.name}
            </span>
            <span
              className="shrink-0 text-xs text-muted-foreground"
              title={rarityLabel(priced.tier)}
            >
              {rarityLabel(priced.tier)}
            </span>
            {valuation.unpriced.length > 0 && (
              <Badge variant="outline" className="shrink-0">
                +{valuation.unpriced.length} unpriced
              </Badge>
            )}
          </span>
        </td>
        <td className="px-2 py-2.5 text-right tabular" title={formatExact(listing.price)}>
          {formatCoins(listing.price)}
        </td>
        <td
          className="px-2 py-2.5 text-right tabular text-muted-foreground"
          title={formatExact(craftCost)}
        >
          {formatCoins(craftCost)}
        </td>
        <td
          className={cn(
            "px-2 py-2.5 text-right tabular",
            spread === null ? "text-muted-foreground" : isDeal ? "text-gain" : "text-loss",
          )}
          title={formatExact(spread)}
        >
          {formatSigned(spread)}
        </td>
        <td className="px-4 py-2.5">
          <ChevronDown
            className={cn(
              "size-4 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
          />
        </td>
      </tr>

      {expanded && (
        <tr className="border-b bg-muted/30">
          <td colSpan={5} className="px-4 pb-4">
            <CostBreakdown valuation={valuation} />
            <SellerCommand auctioneer={listing.auctioneer} />
          </td>
        </tr>
      )}
    </>
  )
}
