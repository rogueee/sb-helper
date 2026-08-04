/**
 * Sort chips shared by every table.
 *
 * Keys are combined rather than chained (see `lib/multiSort`), so no chip shows
 * a rank number — implying a precedence that does not exist would be worse than
 * showing nothing. The hint line says what shift-click does, then switches to
 * naming how many keys are in play once one is combined.
 */
import { Chip } from "@/components/Chip"
import { toggleSortRule, type SortChainOf, type SortDirection } from "@/lib/multiSort"

export interface SortOption<K extends string> {
  key: K
  label: string
  /** Direction this key starts in — highest profit first, but cheapest price first. */
  initial?: SortDirection
}

/**
 * Shift-click walks a key through add → reverse → drop, so what it does next
 * depends on where the key currently sits.
 */
function hintFor(active: boolean, atInitial: boolean, soleKey: boolean): string {
  if (!active) return "Click to sort by this · shift-click to add it to the sort"
  const shift = atInitial
    ? "shift-click to reverse it"
    : soleKey
      ? "shift-click to reverse it back"
      : "shift-click to drop it"
  return `Click to sort by this alone · ${shift}`
}

export function SortChips<K extends string>({
  options,
  sort,
  onChange,
}: {
  options: SortOption<K>[]
  sort: SortChainOf<K>
  onChange: (next: SortChainOf<K>) => void
}) {
  return (
    <>
      {options.map(({ key, label, initial = "asc" }) => {
        const rule = sort.find((r) => r.key === key) ?? null
        return (
          <Chip
            key={key}
            active={rule !== null}
            // Shift builds the combined sort; a plain click replaces it.
            // Passing the modifier through keeps that decision in one place.
            onClick={(e) => onChange(toggleSortRule(sort, key, e.shiftKey, initial))}
            title={hintFor(rule !== null, rule?.direction === initial, sort.length === 1)}
          >
            {label}
            {rule && <span className="ml-1">{rule.direction === "asc" ? "↑" : "↓"}</span>}
          </Chip>
        )
      })}

      <span className="text-xs text-muted-foreground/70">
        {sort.length > 1 ? `${sort.length} keys, weighted equally` : "shift-click to combine keys"}
      </span>
    </>
  )
}
