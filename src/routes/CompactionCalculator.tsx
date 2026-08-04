import { useMemo, useState } from "react"
import { Pin, PinOff, X } from "lucide-react"
import { ItemSearch, type SearchableItem } from "@/components/ItemSearch"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { useBazaar, useItems } from "@/lib/queries"
import { analyseCompaction, compactableInputs, type CompactionResult, type SellMode } from "@/lib/compaction"
import type { BazaarPrices } from "@/lib/pricing/bazaar"
import { prettyId } from "@/lib/pricing/essence"
import { formatCoins, formatExact, formatQuantity, formatSigned } from "@/lib/format"
import { usePins } from "@/lib/useLocalStorage"
import { cn } from "@/lib/utils"

export function CompactionCalculator() {
  const { data: bazaar, isLoading } = useBazaar()
  const { data: items } = useItems()
  const { pins, toggle, isPinned } = usePins("sb-helper:pins:compaction")

  const [mode, setMode] = useState<SellMode>("instant")
  const [selected, setSelected] = useState<string | null>(null)

  // Only items that both trade on the Bazaar and have a compaction route.
  const searchable = useMemo<SearchableItem[]>(() => {
    if (!bazaar) return []
    const names = new Map((items ?? []).map((i) => [i.id, i.name]))
    return compactableInputs(bazaar).map((id) => ({ id, name: names.get(id) ?? prettyId(id) }))
  }, [bazaar, items])

  const nameOf = useMemo(() => {
    const names = new Map(searchable.map((s) => [s.id, s.name]))
    return (id: string) => names.get(id) ?? prettyId(id)
  }, [searchable])

  const result = useMemo(
    () => (bazaar && selected ? analyseCompaction(bazaar, selected, mode) : null),
    [bazaar, selected, mode],
  )

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Compaction</h1>
          <p className="text-sm text-muted-foreground">
            Whether an item is worth more sold raw or crafted into its compacted form.
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
          <span>Sell instantly</span>
          <Switch
            checked={mode === "instant"}
            onCheckedChange={(v) => setMode(v ? "instant" : "offer")}
          />
        </label>
      </div>

      <p className="text-xs text-muted-foreground">
        {mode === "instant"
          ? "Pricing against standing buy orders — what you get dumping right now."
          : "Pricing against your own sell offers — better rates, but you wait for a fill."}
      </p>

      <ItemSearch
        items={searchable}
        onSelect={(item) => setSelected(item.id)}
        placeholder="Search a bazaar item — try Ink Sac"
        autoFocus
      />

      {isLoading && <p className="text-sm text-muted-foreground">Loading bazaar…</p>}

      {pins.length > 0 && bazaar && (
        <section className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Pinned
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pins.map((id) => (
              <PinnedCard
                key={id}
                result={analyseCompaction(bazaar, id, mode)}
                name={nameOf(id)}
                nameOf={nameOf}
                onOpen={() => setSelected(id)}
                onUnpin={() => toggle(id)}
              />
            ))}
          </div>
        </section>
      )}

      {result && bazaar && (
        <ResultPanel
          result={result}
          name={nameOf(result.rawId)}
          nameOf={nameOf}
          bazaar={bazaar}
          pinned={isPinned(result.rawId)}
          onTogglePin={() => toggle(result.rawId)}
        />
      )}
    </div>
  )
}

function Verdict({ result }: { result: CompactionResult }) {
  if (result.deltaPerRaw === null) {
    return <Badge variant="outline">No tradeable compaction</Badge>
  }
  return result.sellRaw ? (
    <Badge variant="loss">Sell raw</Badge>
  ) : (
    <Badge variant="gain">Compact it</Badge>
  )
}

function ResultPanel({
  result,
  name,
  nameOf,
  bazaar,
  pinned,
  onTogglePin,
}: {
  result: CompactionResult
  name: string
  nameOf: (id: string) => string
  bazaar: BazaarPrices
  pinned: boolean
  onTogglePin: () => void
}) {
  const { best, rawPrice, deltaPerRaw } = result

  return (
    <Card>
      <CardContent className="space-y-6 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-medium">{name}</h2>
            <Verdict result={result} />
          </div>
          <Button variant="ghost" size="sm" onClick={onTogglePin}>
            {pinned ? <PinOff /> : <Pin />}
            {pinned ? "Unpin" : "Pin"}
          </Button>
        </div>

        {best && rawPrice !== null && deltaPerRaw !== null ? (
          <>
            {/* The headline comparison, stated per single raw unit so the two
                sides are directly comparable regardless of the ratio. */}
            <div className="flex flex-wrap gap-x-10 gap-y-4">
              <Figure label="Sell raw" sub="per unit" value={formatCoins(rawPrice)} />
              <Figure
                label={`Sell as ${nameOf(best.itemId)}`}
                sub="per raw unit"
                value={formatCoins(best.valuePerRaw)}
              />
              <Figure
                label="Difference"
                sub="per raw unit"
                value={formatSigned(deltaPerRaw)}
                tone={deltaPerRaw > 0 ? "gain" : "loss"}
              />
              <Figure
                label="Per craft"
                sub={`${formatQuantity(best.rawPerUnit)} raw → 1`}
                value={formatSigned(deltaPerRaw * best.rawPerUnit)}
                tone={deltaPerRaw > 0 ? "gain" : "loss"}
              />
            </div>

            <p className="max-w-prose text-sm text-muted-foreground">
              {formatQuantity(best.rawPerUnit)} × {name} sells for{" "}
              <span className="tabular text-foreground">
                {formatCoins(rawPrice * best.rawPerUnit)}
              </span>{" "}
              raw, versus{" "}
              <span className="tabular text-foreground">{formatCoins(best.unitPrice)}</span> as one{" "}
              {nameOf(best.itemId)}.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {rawPrice === null
              ? "This item does not currently trade on the bazaar."
              : "No compacted form of this item trades on the bazaar."}
          </p>
        )}

        {result.rungs.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              All routes
            </h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="pb-1 text-left font-normal">Output</th>
                  <th className="pb-1 text-right font-normal">Raw each</th>
                  <th className="pb-1 text-right font-normal">Unit price</th>
                  <th className="pb-1 text-right font-normal">Value / raw</th>
                  <th className="pb-1 text-right font-normal">vs raw</th>
                </tr>
              </thead>
              <tbody>
                {result.rungs.map((rung) => {
                  const delta = rawPrice === null ? null : rung.valuePerRaw - rawPrice
                  return (
                    <tr key={rung.itemId} className="border-t border-border/50">
                      <td className="py-1.5">{nameOf(rung.itemId)}</td>
                      <td className="py-1.5 text-right tabular text-muted-foreground">
                        {formatQuantity(rung.rawPerUnit)}
                      </td>
                      <td
                        className="py-1.5 text-right tabular"
                        title={formatExact(rung.unitPrice)}
                      >
                        {formatCoins(rung.unitPrice)}
                      </td>
                      <td className="py-1.5 text-right tabular">
                        {formatCoins(rung.valuePerRaw)}
                      </td>
                      <td
                        className={cn(
                          "py-1.5 text-right tabular",
                          delta !== null && (delta > 0 ? "text-gain" : "text-loss"),
                        )}
                      >
                        {formatSigned(delta)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {!bazaar.has(result.rawId) && (
          <p className="text-xs text-muted-foreground">Raw item is not sold on the bazaar.</p>
        )}
      </CardContent>
    </Card>
  )
}

function Figure({
  label,
  sub,
  value,
  tone,
}: {
  label: string
  sub?: string
  value: string
  tone?: "gain" | "loss"
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">
        {label}
        {sub && <span className="ml-1.5 opacity-70">{sub}</span>}
      </div>
      <div
        className={cn(
          "text-xl font-medium tabular",
          tone === "gain" && "text-gain",
          tone === "loss" && "text-loss",
        )}
      >
        {value}
      </div>
    </div>
  )
}

function PinnedCard({
  result,
  name,
  nameOf,
  onOpen,
  onUnpin,
}: {
  result: CompactionResult
  name: string
  nameOf: (id: string) => string
  onOpen: () => void
  onUnpin: () => void
}) {
  const { best, deltaPerRaw } = result

  return (
    <div className="group relative rounded-lg border p-4">
      <button
        type="button"
        onClick={onUnpin}
        aria-label={`Unpin ${name}`}
        className="absolute right-2 top-2 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
      >
        <X className="size-3.5" />
      </button>

      <button type="button" onClick={onOpen} className="w-full text-left">
        <div className="truncate pr-6 text-sm font-medium">{name}</div>
        {best && deltaPerRaw !== null ? (
          <>
            <div
              className={cn(
                "mt-1 text-lg font-medium tabular",
                deltaPerRaw > 0 ? "text-gain" : "text-loss",
              )}
            >
              {formatSigned(deltaPerRaw)}
              <span className="ml-1 text-xs font-normal text-muted-foreground">/ raw</span>
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground">
              {deltaPerRaw > 0 ? "Compact into" : "Beats"} {nameOf(best.itemId)}
            </div>
          </>
        ) : (
          <div className="mt-1 text-sm text-muted-foreground">No tradeable route</div>
        )}
      </button>
    </div>
  )
}
