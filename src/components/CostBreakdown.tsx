import { Fragment } from "react"
import type { CostGroup, CostLine, Valuation } from "@/lib/pricing/valuate"
import { formatCoins, formatExact, formatQuantity } from "@/lib/format"
import { cn } from "@/lib/utils"

const GROUP_LABELS: Record<CostGroup, string> = {
  enchants: "Enchantments",
  stars: "Stars & essence",
  gems: "Gemstones",
  reforge: "Reforge",
  upgrades: "Upgrades",
  other: "Other",
}

const GROUP_ORDER: CostGroup[] = ["enchants", "stars", "gems", "reforge", "upgrades", "other"]

export function CostBreakdown({ valuation }: { valuation: Valuation }) {
  const byGroup = new Map<CostGroup, CostLine[]>()
  for (const line of valuation.lines) {
    const list = byGroup.get(line.group) ?? []
    list.push(line)
    byGroup.set(line.group, list)
  }

  if (valuation.lines.length === 0) {
    return <p className="py-3 text-sm text-muted-foreground">Clean item — no applied modifiers.</p>
  }

  return (
    <table className="w-full text-sm">
      <tbody>
        {GROUP_ORDER.filter((g) => byGroup.has(g)).map((group) => {
          const lines = byGroup.get(group)!
          const subtotal = lines.reduce((sum, l) => sum + (l.total ?? 0), 0)

          return (
            <Fragment key={group}>
              <tr>
                <td
                  colSpan={2}
                  className="pt-4 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  {GROUP_LABELS[group]}
                </td>
                <td className="pt-4 pb-1 text-right text-xs tabular text-muted-foreground">
                  {formatCoins(subtotal)}
                </td>
              </tr>

              {lines.map((line, i) => (
                <tr key={`${group}-${i}`} className="border-t border-border/50">
                  <td className="py-1.5 pr-3">
                    <span className={cn(line.total === null && "text-muted-foreground")}>
                      {line.label}
                    </span>
                    {line.note && (
                      <span
                        className={cn(
                          "ml-2 text-xs",
                          line.substituted ? "text-loss/80" : "text-muted-foreground",
                        )}
                      >
                        {line.note}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular text-xs text-muted-foreground">
                    {line.quantity > 1 ? `${formatQuantity(line.quantity)} ×` : ""}
                  </td>
                  <td
                    className="py-1.5 text-right tabular"
                    title={line.total === null ? undefined : formatExact(line.total)}
                  >
                    {line.total === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      formatCoins(line.total)
                    )}
                  </td>
                </tr>
              ))}
            </Fragment>
          )
        })}

        <tr className="border-t">
          <td colSpan={2} className="pt-3 font-medium">
            Component total
            {valuation.unpriced.length > 0 && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                excludes {valuation.unpriced.length} unpriced
              </span>
            )}
            {valuation.substituted.length > 0 && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {valuation.substituted.length} priced at a higher level
              </span>
            )}
          </td>
          <td
            className="pt-3 text-right font-medium tabular"
            title={formatExact(valuation.componentTotal)}
          >
            {formatCoins(valuation.componentTotal)}
          </td>
        </tr>
      </tbody>
    </table>
  )
}
