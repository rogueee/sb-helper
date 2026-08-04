import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronDown, Loader2, RefreshCw } from "lucide-react"
import { ItemSearch, type SearchableItem } from "@/components/ItemSearch"
import { CostBreakdown } from "@/components/CostBreakdown"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useBazaar, useItemMap } from "@/lib/queries"
import {
  findListings,
  loadCachedIndex,
  sweepAuctions,
  type AuctionIndex,
  type DecodedListing,
  type SweepProgress,
} from "@/lib/auctionIndex"
import { valuate, type Valuation } from "@/lib/pricing/valuate"
import type { BazaarPrices } from "@/lib/pricing/bazaar"
import { formatCoins, formatExact, formatRelativeTime, formatSigned } from "@/lib/format"
import { cn } from "@/lib/utils"

interface PricedListing {
  listing: DecodedListing
  valuation: Valuation
  /** Base item + every modifier. Null when no clean base could be priced. */
  craftCost: number | null
  /**
   * listing price - craftCost. Negative means the listing is cheaper than
   * assembling the same thing yourself, i.e. worth buying.
   */
  spread: number | null
}

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

  const [index, setIndex] = useState<AuctionIndex | null>(null)
  const [progress, setProgress] = useState<SweepProgress | null>(null)
  const [selected, setSelected] = useState<SearchableItem | null>(null)
  const [results, setResults] = useState<PricedListing[] | null>(null)
  const [baseCost, setBaseCost] = useState<number | null>(null)
  const [searching, setSearching] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Reuse a recent index rather than making the user re-pay the sweep.
  useEffect(() => {
    loadCachedIndex().then((cached) => cached && setIndex(cached))
  }, [])

  const searchable = useMemo<SearchableItem[]>(
    () => (items ?? []).map((i) => ({ id: i.id, name: i.name })),
    [items],
  )

  const runSweep = useCallback(async () => {
    setProgress({ done: 0, total: 50 })
    setError(null)
    try {
      setIndex(await sweepAuctions(setProgress))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the auction house")
    } finally {
      setProgress(null)
    }
  }, [])

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
            return {
              ...p,
              craftCost,
              spread: craftCost === null ? null : p.listing.price - craftCost,
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

  const cheapest = results?.[0]

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

      {error && <p className="text-sm text-loss">{error}</p>}

      {!index && !progress ? (
        <EmptyIndex onLoad={runSweep} />
      ) : (
        <>
          <ItemSearch
            items={searchable}
            onSelect={setSelected}
            placeholder="Search for an item — try Hyperion"
            autoFocus
          />

          {searching && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Decoding listings…
            </p>
          )}

          {selected && results && !searching && (
            <>
              {results.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No BIN listings found for {selected.name}.
                </p>
              ) : (
                <>
                  <SummaryRow
                    item={selected}
                    cheapest={cheapest}
                    count={results.length}
                    baseCost={baseCost}
                  />
                  <div className="rounded-lg border">
                    <div className="grid grid-cols-[1fr_auto_auto_auto_2rem] items-center gap-4 border-b px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <span>Listing</span>
                      <span className="text-right">Price</span>
                      <span className="text-right">Craft cost</span>
                      <span className="text-right">Spread</span>
                      <span />
                    </div>
                    {results.map((p) => (
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
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

function IndexStatus({
  index,
  progress,
  onRefresh,
}: {
  index: AuctionIndex | null
  progress: SweepProgress | null
  onRefresh: () => void
}) {
  if (progress) {
    const pct = Math.round((progress.done / progress.total) * 100)
    return (
      <div className="w-56 space-y-1.5">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Loading auctions</span>
          <span className="tabular">
            {progress.done}/{progress.total}
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-secondary">
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
    )
  }

  if (!index) return null

  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="tabular">
        {index.listings.length.toLocaleString()} auctions ·{" "}
        {formatRelativeTime(index.fetchedAt)}
      </span>
      <Button variant="ghost" size="sm" onClick={onRefresh}>
        <RefreshCw /> Refresh
      </Button>
    </div>
  )
}

function EmptyIndex({ onLoad }: { onLoad: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Load the auction house</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="max-w-prose text-sm text-muted-foreground">
          Hypixel has no server-side search, so finding every listing of an item means downloading
          all 50 pages of active auctions — roughly 120 MB, once. After that, searches are instant
          and the index is cached for five minutes.
        </p>
        <Button onClick={onLoad}>Load auction index</Button>
      </CardContent>
    </Card>
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
          <span className="truncate">{listing.name}</span>
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
        </div>
      )}
    </div>
  )
}
