/**
 * Raw vs compacted valuation.
 *
 * Compacting is only worth it when the compacted item sells for more than the
 * raw materials it consumes. Ink Sac is the canonical case: 80 raw into one
 * Enchanted Ink Sac, which frequently sells for *less* than the 80 Ink Sacs did.
 *
 * The verdict genuinely depends on how you sell, so both directions are
 * supported: instant (fill existing orders) or patient (place your own offer).
 */
import compactionData from "@/data/compaction.json"
import type { BazaarPrices, PriceMode } from "./pricing/bazaar"

export interface CompactionStep {
  input: string
  output: string
  ratio: number
}

const STEPS = compactionData as CompactionStep[]

/** input id -> every craft that consumes only that item. */
const BY_INPUT = new Map<string, CompactionStep[]>()
for (const step of STEPS) {
  const list = BY_INPUT.get(step.input) ?? []
  list.push(step)
  BY_INPUT.set(step.input, list)
}

export type SellMode = "instant" | "offer"

function sellPriceMode(mode: SellMode): PriceMode {
  // Selling instantly fills into standing buy orders; a sell offer competes at
  // the instabuy price instead.
  return mode === "instant" ? "instasell" : "sellOffer"
}

export interface CompactionRung {
  /** Item produced at this rung. */
  itemId: string
  /** How many of the original raw item one of these consumes. */
  rawPerUnit: number
  /** Unit sale price of this item. */
  unitPrice: number
  /** Value of one raw item's worth, expressed through this rung. */
  valuePerRaw: number
  /** Chain of crafts from the raw item to here. */
  path: CompactionStep[]
}

export interface CompactionResult {
  rawId: string
  /** Unit sale price of the raw item, or null if it does not trade. */
  rawPrice: number | null
  rungs: CompactionRung[]
  /** Highest-value rung, or null when nothing beats selling raw. */
  best: CompactionRung | null
  /** best.valuePerRaw - rawPrice, per raw unit. Negative means sell raw. */
  deltaPerRaw: number | null
  /** True when selling the raw item is the better play. */
  sellRaw: boolean
}

/**
 * Walks the compaction chain from `rawId`, breadth-first.
 *
 * Only outputs that actually trade on the Bazaar are kept: NEU's recipe data
 * also contains uniform-ingredient crafts like Diamond into Diamond Boots,
 * which are not compaction and have no Bazaar price to compare against.
 */
export function analyseCompaction(
  bz: BazaarPrices,
  rawId: string,
  mode: SellMode = "instant",
  maxDepth = 3,
): CompactionResult {
  const priceMode = sellPriceMode(mode)
  const rawPrice = bz.price(rawId, priceMode)

  const rungs: CompactionRung[] = []
  const seen = new Set<string>([rawId])

  let frontier: { itemId: string; rawPerUnit: number; path: CompactionStep[] }[] = [
    { itemId: rawId, rawPerUnit: 1, path: [] },
  ]

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: typeof frontier = []

    for (const node of frontier) {
      for (const step of BY_INPUT.get(node.itemId) ?? []) {
        if (seen.has(step.output)) continue
        seen.add(step.output)

        const rawPerUnit = node.rawPerUnit * step.ratio
        const path = [...node.path, step]

        const unitPrice = bz.price(step.output, priceMode)
        if (unitPrice !== null) {
          rungs.push({
            itemId: step.output,
            rawPerUnit,
            unitPrice,
            valuePerRaw: unitPrice / rawPerUnit,
            path,
          })
        }

        // Keep walking even through a rung that has no price of its own, since
        // a deeper one might trade (raw block -> enchanted -> enchanted block).
        next.push({ itemId: step.output, rawPerUnit, path })
      }
    }

    frontier = next
  }

  rungs.sort((a, b) => b.valuePerRaw - a.valuePerRaw)
  const best = rungs[0] ?? null

  const deltaPerRaw = best && rawPrice !== null ? best.valuePerRaw - rawPrice : null

  return {
    rawId,
    rawPrice,
    rungs,
    best,
    deltaPerRaw,
    sellRaw: deltaPerRaw === null ? true : deltaPerRaw <= 0,
  }
}

/** Every Bazaar item that has at least one compaction route worth showing. */
export function compactableInputs(bz: BazaarPrices): string[] {
  return [...BY_INPUT.keys()].filter((id) => bz.has(id)).sort()
}
