import { useMemo, useState } from "react"
import { Loader2, Pin, PinOff } from "lucide-react"
import { Chip } from "@/components/Chip"
import { SortChips, type SortOption } from "@/components/SortChips"
import { Input } from "@/components/ui/input"
import { useBazaar, useItemMap } from "@/lib/queries"
import { analyseBazaarFlips, type BazaarFlip } from "@/lib/bazaarFlips"
import { BAZAAR_TAX_LABELS, type BazaarTaxTier } from "@/lib/fees"
import { multiSort, type SortChainOf } from "@/lib/multiSort"
import { formatCoins, formatExact, formatQuantity } from "@/lib/format"
import { useLocalStorage, usePins } from "@/lib/useLocalStorage"
import { cn } from "@/lib/utils"

type FlipSortKey = "marketProfitPerHour" | "margin" | "marginPct" | "unitsPerHour" | "buyOrderPrice"

const SORT_OPTIONS: SortOption<FlipSortKey>[] = [
  { key: "marketProfitPerHour", label: "Flow / hour", initial: "desc" },
  { key: "margin", label: "Margin", initial: "desc" },
  { key: "marginPct", label: "Margin %", initial: "desc" },
  { key: "unitsPerHour", label: "Volume", initial: "desc" },
  { key: "buyOrderPrice", label: "Unit cost" },
]

const DEFAULT_SORT: SortChainOf<FlipSortKey> = [
  // Margin alone rewards illiquid junk and volume alone rewards zero-margin
  // staples; weighting both equally is the whole reason this table is useful.
  { key: "margin", direction: "desc" },
  { key: "unitsPerHour", direction: "desc" },
]

/** Weekly volume floors, as "both sides must move at least this much". */
const VOLUME_TIERS = [
  { value: 10_000, label: "10k" },
  { value: 100_000, label: "100k" },
  { value: 1_000_000, label: "1m" },
]

function sortValue(f: BazaarFlip, key: FlipSortKey): number | null {
  return f[key]
}

export function BazaarFlips() {
  const { data: bazaar, isFetching } = useBazaar()
  const { items } = useItemMap()

  const [minVolume, setMinVolume] = useLocalStorage("bzflip:minVolume", 100_000)
  const [tax, setTax] = useLocalStorage<BazaarTaxTier>("bazaar:tax", "base")
  const [sort, setSort] = useState<SortChainOf<FlipSortKey>>(DEFAULT_SORT)
  const [query, setQuery] = useState("")
  const { pins, toggle, isPinned } = usePins("bzflip:pins")

  const names = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of items ?? []) map.set(item.id, item.name)
    return map
  }, [items])

  const flips = useMemo(() => {
    if (!bazaar) return null
    return analyseBazaarFlips(bazaar, names, { tax, minWeeklyVolume: minVolume })
  }, [bazaar, names, tax, minVolume])

  const visible = useMemo(() => {
    if (!flips) return null
    const needle = query.trim().toLowerCase()
    const matched = needle ? flips.filter((f) => f.name.toLowerCase().includes(needle)) : flips
    const sorted = multiSort(matched, sort, sortValue)
    // Pinned products stay on top in their sorted order, so a watchlist does
    // not disappear the moment the ranking moves.
    return [
      ...sorted.filter((f) => isPinned(f.productId)),
      ...sorted.filter((f) => !isPinned(f.productId)),
    ]
  }, [flips, query, sort, isPinned])

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Bazaar flips</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Buy with a buy order, sell with a sell offer, and keep the gap between the two books.
          Margins are net of bazaar tax, and only products with real two-sided volume are listed —
          the widest spreads almost always belong to items nobody trades.
        </p>
      </div>

      <div className="space-y-2.5 rounded-lg border bg-muted/20 px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-24 shrink-0 text-xs text-muted-foreground">Min volume</span>
          {VOLUME_TIERS.map((tier) => (
            <Chip
              key={tier.value}
              active={minVolume === tier.value}
              onClick={() => setMinVolume(tier.value)}
              title={`Both sides must move at least ${tier.label} units per week`}
            >
              {tier.label}/wk
            </Chip>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-24 shrink-0 text-xs text-muted-foreground">Bazaar tax</span>
          {(Object.keys(BAZAAR_TAX_LABELS) as BazaarTaxTier[]).map((tier) => (
            <Chip key={tier} active={tax === tier} onClick={() => setTax(tier)}>
              {BAZAAR_TAX_LABELS[tier]}
            </Chip>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-24 shrink-0 text-xs text-muted-foreground">Sort</span>
          <SortChips options={SORT_OPTIONS} sort={sort} onChange={setSort} />

          <div className="ml-auto flex items-center gap-2">
            {isFetching && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
            <span className="text-xs tabular text-muted-foreground">
              {visible?.length ?? 0} products
            </span>
          </div>
        </div>
      </div>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter by name"
        className="max-w-xs"
      />

      {visible === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading bazaar…
        </p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No products clear a positive margin at this volume floor.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="w-10 px-4 py-2" />
                <th className="px-2 py-2 text-left font-medium">Product</th>
                <th className="px-2 py-2 text-right font-medium">Buy order</th>
                <th className="px-2 py-2 text-right font-medium">Sell offer</th>
                <th className="px-2 py-2 text-right font-medium">Margin</th>
                <th className="px-2 py-2 text-right font-medium">Units / hr</th>
                <th className="px-4 py-2 text-right font-medium">Flow / hr</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((flip) => (
                <FlipRow
                  key={flip.productId}
                  flip={flip}
                  pinned={isPinned(flip.productId)}
                  onPin={() => toggle(flip.productId)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pins.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {pins.length} pinned product{pins.length === 1 ? "" : "s"} held at the top. A pin that
          drops below the volume floor or turns unprofitable will not appear at all.
        </p>
      )}
    </div>
  )
}

function FlipRow({
  flip,
  pinned,
  onPin,
}: {
  flip: BazaarFlip
  pinned: boolean
  onPin: () => void
}) {
  return (
    <tr className="border-b text-sm last:border-b-0 hover:bg-accent/50">
      <td className="px-4 py-2.5">
        <button
          type="button"
          onClick={onPin}
          title={pinned ? "Unpin" : "Pin to the top"}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          {pinned ? (
            <Pin className="size-3.5 fill-current" />
          ) : (
            <PinOff className="size-3.5 opacity-40" />
          )}
        </button>
      </td>

      <td className={cn("w-full max-w-0 truncate px-2 py-2.5", pinned && "font-medium")}>
        {flip.name}
      </td>

      <td
        className="px-2 py-2.5 text-right tabular text-muted-foreground"
        title={formatExact(flip.buyOrderPrice)}
      >
        {formatCoins(flip.buyOrderPrice)}
      </td>
      <td
        className="px-2 py-2.5 text-right tabular text-muted-foreground"
        title={formatExact(flip.sellOfferPrice)}
      >
        {formatCoins(flip.sellOfferPrice)}
      </td>
      <td className="px-2 py-2.5 text-right tabular text-gain" title={formatExact(flip.margin)}>
        {formatCoins(flip.margin)}
        {/* Parenthesised: without it "398" and "32.4%" read as one number. */}
        <span className="ml-1.5 text-xs text-muted-foreground">
          ({(flip.marginPct * 100).toFixed(1)}%)
        </span>
      </td>
      <td
        className="px-2 py-2.5 text-right tabular text-muted-foreground"
        title={`${formatQuantity(flip.buyVolumeWeek)} bought / ${formatQuantity(flip.sellVolumeWeek)} sold per week`}
      >
        {formatQuantity(Math.round(flip.unitsPerHour))}
      </td>
      <td
        className="px-4 py-2.5 text-right tabular"
        title="Margin x the whole market's hourly flow — an upper bound, not your throughput"
      >
        {formatCoins(flip.marketProfitPerHour)}
      </td>
    </tr>
  )
}
