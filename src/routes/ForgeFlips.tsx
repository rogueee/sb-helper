import { useEffect, useMemo, useState } from "react"
import { ChevronDown, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Chip } from "@/components/Chip"
import { SortChips, type SortOption } from "@/components/SortChips"
import { EmptyIndex, IndexStatus, RestoringIndex, useAuctionIndex } from "@/components/AuctionIndex"
import { useBazaar, useItemMap } from "@/lib/queries"
import { buildLbin } from "@/lib/lbin"
import {
  formatForgeTime,
  isPetId,
  prettifyId,
  valueAllForgeFlips,
  FORGE_RECIPES,
  type ForgeFlip,
  type SellMode,
} from "@/lib/forge"
import { BAZAAR_TAX_LABELS, type BazaarTaxTier } from "@/lib/fees"
import { multiSort, type SortChainOf } from "@/lib/multiSort"
import { formatCoins, formatExact, formatQuantity, formatSigned } from "@/lib/format"
import { useLocalStorage } from "@/lib/useLocalStorage"
import { cn } from "@/lib/utils"

type ForgeSortKey = "profitPerHour" | "profit" | "materialCost" | "hours"

const SORT_OPTIONS: SortOption<ForgeSortKey>[] = [
  // Profit keys start descending — the point of the table is the top of it.
  { key: "profitPerHour", label: "Profit / hour", initial: "desc" },
  { key: "profit", label: "Profit", initial: "desc" },
  { key: "materialCost", label: "Material cost" },
  { key: "hours", label: "Forge time" },
]

const DEFAULT_SORT: SortChainOf<ForgeSortKey> = [{ key: "profitPerHour", direction: "desc" }]

function sortValue(f: ForgeFlip, key: ForgeSortKey): number | null {
  switch (key) {
    case "profitPerHour":
      return f.profitPerHour
    case "profit":
      return f.profit
    case "materialCost":
      return f.materialCost
    case "hours":
      return f.hours
  }
}

export function ForgeFlips() {
  const { data: bazaar } = useBazaar()
  const { data: itemMap } = useItemMap()
  const { index, progress, error: indexError, load: runSweep, restoring } = useAuctionIndex()

  const [lbin, setLbin] = useState<Map<string, number> | null>(null)
  const [lbinError, setLbinError] = useState<string | null>(null)
  const [building, setBuilding] = useState(false)
  const [quickForge, setQuickForge] = useLocalStorage("forge:quickForge", 0)
  const [tax, setTax] = useLocalStorage<BazaarTaxTier>("bazaar:tax", "base")
  const [sellMode, setSellMode] = useLocalStorage<SellMode>("forge:sellMode", "offer")
  const [profitableOnly, setProfitableOnly] = useState(true)
  const [sort, setSort] = useState<SortChainOf<ForgeSortKey>>(DEFAULT_SORT)
  const [expanded, setExpanded] = useState<string | null>(null)

  const names = useMemo(() => {
    const map = new Map<string, string>()
    for (const recipe of FORGE_RECIPES) {
      const name = itemMap?.get(recipe.output)?.name
      if (name) map.set(recipe.output, name)
    }
    return map
  }, [itemMap])

  // The auction leg needs a lowest-BIN per forge output, which means decoding a
  // few hundred listings. Done once per index rather than per re-price, since
  // the Bazaar refreshes every minute and the auction data does not.
  useEffect(() => {
    if (!index || !itemMap) return

    let cancelled = false
    setBuilding(true)

    // Inputs need lbin as much as outputs do: drill parts, beacons and
    // crystals are auction-only, and without a price for them the recipes that
    // consume them cannot be valued at all.
    const ids = new Set<string>()
    for (const recipe of FORGE_RECIPES) {
      if (!isPetId(recipe.output)) ids.add(recipe.output)
      for (const input of recipe.inputs) {
        if (!isPetId(input.id) && input.id !== "SKYBLOCK_COIN") ids.add(input.id)
      }
    }

    const targets = [...ids].map((id) => ({
      id,
      name: itemMap.get(id)?.name ?? prettifyId(id),
    }))

    buildLbin(index, targets)
      .then((map) => {
        if (cancelled) return
        setLbin(map)
        setLbinError(null)
      })
      .catch((err) => {
        if (cancelled) return
        // Falling back to an empty map silently would look like "no forge
        // output sells on the auction house", which is very different from
        // "the lookup broke".
        setLbin(new Map())
        setLbinError(err instanceof Error ? err.message : "Could not read auction prices")
      })
      .finally(() => !cancelled && setBuilding(false))

    return () => {
      cancelled = true
    }
  }, [index, itemMap])

  const flips = useMemo(() => {
    if (!bazaar) return null
    return valueAllForgeFlips(bazaar, lbin ?? new Map(), names, {
      quickForge,
      bazaarTax: tax,
      sellMode,
    })
  }, [bazaar, lbin, names, quickForge, tax, sellMode])

  const visible = useMemo(() => {
    // Most forge output sells on the auction house, so until lbin lands the
    // table would show a bazaar-only view — far fewer recipes, several of them
    // wrongly unprofitable. Showing that as if it were the answer invites
    // acting on it, so the table waits for the real prices.
    if (!flips || lbin === null) return null
    const filtered = profitableOnly
      ? flips.filter((f) => f.profit !== null && f.profit > 0)
      : flips.filter((f) => f.profit !== null)
    return multiSort(filtered, sort, sortValue)
  }, [flips, lbin, profitableOnly, sort])

  // Recipes dropped for want of a price are worth admitting to: silence would
  // look like the forge simply has fewer recipes than it does.
  const unpriceable = useMemo(
    () => (flips ? flips.filter((f) => f.profit === null).length : 0),
    [flips],
  )

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Forge flips</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Buy the materials at bazaar instabuy, wait out the forge, sell the result. Ranked on
            profit per hour, because the timer is what a forge flip really costs.
          </p>
        </div>
        <IndexStatus index={index} progress={progress} onRefresh={runSweep} />
      </div>

      {(indexError ?? lbinError) && (
        <p className="text-sm text-loss">{indexError ?? lbinError}</p>
      )}

      {restoring && !index ? (
        <RestoringIndex />
      ) : !index && !progress ? (
        <EmptyIndex
          onLoad={runSweep}
          reason="Forge outputs are sold on the auction house, so ranking them needs the lowest BIN for each one — and Hypixel has no server-side search. That means downloading all 50 pages of active auctions, roughly 120 MB, once."
        />
      ) : (
        <>
          <div className="space-y-2.5 rounded-lg border bg-muted/20 px-4 py-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-24 shrink-0 text-xs text-muted-foreground">Quick Forge</span>
              {[0, 10, 15, 20].map((level) => (
                <Chip
                  key={level}
                  active={quickForge === level}
                  onClick={() => setQuickForge(level)}
                  title={
                    level === 0
                      ? "No Quick Forge perk"
                      : `HotM Quick Forge ${level} — forge times cut accordingly`
                  }
                >
                  {level === 0 ? "None" : `Lvl ${level}`}
                </Chip>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-24 shrink-0 text-xs text-muted-foreground">Bazaar sale</span>
              <Chip
                active={sellMode === "offer"}
                onClick={() => setSellMode("offer")}
                title="Place a sell offer — how forge output is normally sold, since the wait is already paid"
              >
                Sell offer
              </Chip>
              <Chip
                active={sellMode === "instant"}
                onClick={() => setSellMode("instant")}
                title="Dump into standing buy orders — guaranteed, but a thin book can price an item at a fraction of its value"
              >
                Instant
              </Chip>
              <span className="text-xs text-muted-foreground/70">
                auction outputs always use lowest BIN
              </span>
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
                {building && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
                <Chip active={profitableOnly} onClick={() => setProfitableOnly(!profitableOnly)}>
                  Profitable only
                </Chip>
                <span className="text-xs tabular text-muted-foreground">
                  {visible?.length ?? 0} recipes
                </span>
              </div>
            </div>
          </div>

          {unpriceable > 0 && (
            <p className="text-xs text-muted-foreground">
              {unpriceable} recipe{unpriceable === 1 ? "" : "s"} hidden — a material or the output
              has no live price. They are excluded rather than counted as free, since an omitted
              material would overstate profit.
            </p>
          )}

          {visible === null ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {building || lbin === null
                ? "Reading auction prices for every forge material and output…"
                : "Pricing recipes…"}
            </p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No forge recipes are profitable at current prices.
            </p>
          ) : (
            <div className="rounded-lg border">
              <div className="grid grid-cols-[1fr_auto_auto_auto_auto_2rem] items-center gap-4 border-b px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <span>Recipe</span>
                <span className="text-right">Materials</span>
                <span className="text-right">Sells for</span>
                <span className="text-right">Profit</span>
                <span className="text-right">Per hour</span>
                <span />
              </div>
              {visible.map((flip) => (
                <FlipRow
                  key={flip.recipe.output}
                  flip={flip}
                  expanded={expanded === flip.recipe.output}
                  onToggle={() =>
                    setExpanded(expanded === flip.recipe.output ? null : flip.recipe.output)
                  }
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function FlipRow({
  flip,
  expanded,
  onToggle,
}: {
  flip: ForgeFlip
  expanded: boolean
  onToggle: () => void
}) {
  const gain = flip.profit !== null && flip.profit > 0

  return (
    <div className="border-b last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="grid w-full grid-cols-[1fr_auto_auto_auto_auto_2rem] items-center gap-4 px-4 py-2.5 text-left text-sm hover:bg-accent/50"
      >
        <span className="flex items-center gap-2 truncate">
          <span className="truncate font-medium">{flip.name}</span>
          {flip.recipe.count > 1 && (
            <span className="shrink-0 text-xs text-muted-foreground">x{flip.recipe.count}</span>
          )}
          <Badge variant="outline" className="shrink-0">
            {formatForgeTime(flip.hours)}
          </Badge>
          {/*
            Which market the sale price came from changes how believable it is:
            a bazaar instasell always fills, a lowest BIN is one listing deep.
          */}
          <span className="shrink-0 text-xs text-muted-foreground">
            {flip.saleSource === "auction" ? "AH lbin" : "bazaar"}
          </span>
        </span>
        <span className="text-right tabular text-muted-foreground" title={formatExact(flip.materialCost)}>
          {formatCoins(flip.materialCost)}
        </span>
        <span className="text-right tabular text-muted-foreground" title={formatExact(flip.saleNet)}>
          {formatCoins(flip.saleNet)}
        </span>
        <span
          className={cn("text-right tabular", gain ? "text-gain" : "text-loss")}
          title={formatExact(flip.profit)}
        >
          {formatSigned(flip.profit)}
        </span>
        <span className={cn("text-right tabular", gain ? "text-gain" : "text-loss")}>
          {formatSigned(flip.profitPerHour)}
        </span>
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded && (
        <div className="space-y-2 border-t bg-muted/30 px-4 py-3 text-sm">
          {flip.inputs.map((line) => (
            <div key={line.id} className="flex items-baseline justify-between gap-4">
              <span className="text-muted-foreground">
                {formatQuantity(line.qty)}x {prettifyId(line.id)}
                {line.note && <span className="ml-2 text-xs">{line.note}</span>}
              </span>
              <span className="tabular" title={formatExact(line.total)}>
                {formatCoins(line.total)}
              </span>
            </div>
          ))}

          <div className="flex items-baseline justify-between gap-4 border-t pt-2">
            <span className="text-muted-foreground">Materials</span>
            <span className="tabular">{formatCoins(flip.materialCost)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-muted-foreground">
              Sale, gross {flip.saleSource === "auction" ? "(AH lowest BIN)" : "(bazaar)"}
            </span>
            <span className="tabular">{formatCoins(flip.saleGross)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-muted-foreground">After tax</span>
            <span className="tabular">{formatCoins(flip.saleNet)}</span>
          </div>

          {/*
            Both bazaar prices, always. A product whose sell offer is orders of
            magnitude above its instasell has an empty buy-order book, and
            seeing the two side by side is the only way to catch that before
            trusting either number.
          */}
          {flip.saleSource === "bazaar" && (
            <div className="flex items-baseline justify-between gap-4 text-xs text-muted-foreground">
              <span>Bazaar book</span>
              <span className="tabular">
                sell offer {formatCoins(flip.bazaarAlternative.offer)} · instant{" "}
                {formatCoins(flip.bazaarAlternative.instant)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
