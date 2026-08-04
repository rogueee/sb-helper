/**
 * Dwarven Forge flip valuation.
 *
 * A forge flip is: buy the materials off the Bazaar now, wait out the forge
 * timer, sell the result. The wait is the whole point — a 500k profit is
 * excellent over 30 seconds and mediocre over a week — so everything here is
 * ultimately ranked on profit per hour rather than raw spread.
 *
 * Materials are sourced at Bazaar instabuy, since that is what actually filling
 * an order costs. The output is sold at AH lowest-BIN where the item trades on
 * the auction house, falling back to Bazaar instasell for the many forge
 * outputs (Refined Mithril, Gemstone Mixture) that are Bazaar goods.
 */
import forgeData from "@/data/forge.json"
import { auctionNetProceeds, bazaarNetProceeds, type BazaarTaxTier } from "./fees"
import { unpricedNote, type BazaarPrices } from "./pricing/bazaar"

export interface ForgeIngredient {
  id: string
  qty: number
}

export interface ForgeRecipe {
  output: string
  /** Units produced per forge. */
  count: number
  /** Forge time in seconds, before any Quick Forge reduction. */
  seconds: number
  inputs: ForgeIngredient[]
}

export const FORGE_RECIPES = forgeData as ForgeRecipe[]

/** NEU writes coins as a pseudo-item; they are worth exactly their face value. */
const COIN_ID = "SKYBLOCK_COIN"

/**
 * Pets are recipe outputs too, but pet pricing depends on level, held item and
 * candy — a subsystem this app deliberately does not model. Rather than quote a
 * base-level price as if it were the real one, they are left out.
 */
export function isPetId(id: string): boolean {
  return id.includes(";")
}

/**
 * Quick Forge (Heart of the Mountain) shortens every forge.
 *
 *   reduction% = min(30, 10 + level x 0.5 + floor(level / 20) x 10)
 *
 * Level 0 means the perk is not unlocked at all, which the formula does not
 * cover — it would claim 10% for someone who has no perk.
 */
export function quickForgeMultiplier(level: number): number {
  if (level <= 0) return 1
  const reduction = Math.min(30, 10 + level * 0.5 + Math.floor(level / 20) * 10)
  return 1 - reduction / 100
}

export interface ForgeCostLine {
  id: string
  qty: number
  /** Unit price, or null when the material cannot be priced at all. */
  unit: number | null
  total: number | null
  /** Where the unit price came from — many materials are auction-only. */
  source: "bazaar" | "auction" | "coins" | null
  note?: string
}

export type SaleSource = "auction" | "bazaar"

/**
 * How the bazaar leg of a sale is priced.
 *
 * This matters more than it looks. Refined Mithril currently quotes an instabuy
 * of ~596k against an instasell of ~8.6k — a 69x gap that means its buy-order
 * book is empty, not that the item is worth 8.6k. Valuing forge output by
 * instasell would post a fictional quarter-million loss on it.
 *
 * Forge output is sold by placing a sell offer, since you have already waited
 * hours; "instant" is offered as the conservative floor, and both prices show
 * in the breakdown so a broken book is visible rather than silently believed.
 */
export type SellMode = "offer" | "instant"

export interface ForgeFlip {
  recipe: ForgeRecipe
  /** Display name of the output, for search and the table. */
  name: string
  inputs: ForgeCostLine[]
  /** Total material cost, or null when any input is unpriceable. */
  materialCost: number | null
  /** Gross sale price of the full output stack, before tax. */
  saleGross: number | null
  /** Sale price after listing/collection or bazaar tax. */
  saleNet: number | null
  saleSource: SaleSource | null
  /** The bazaar price not chosen, so a lopsided order book is visible. */
  bazaarAlternative: { offer: number | null; instant: number | null }
  /** saleNet - materialCost. Null when either side could not be priced. */
  profit: number | null
  /** Forge time after Quick Forge, in hours. */
  hours: number
  profitPerHour: number | null
  /** Materials with no price; a flip is not ranked while this is non-empty. */
  unpriced: string[]
}

export interface ForgeOptions {
  /** Heart of the Mountain Quick Forge level, 0-20. */
  quickForge?: number
  bazaarTax?: BazaarTaxTier
  sellMode?: SellMode
}

/**
 * Prices one recipe.
 *
 * An input with no Bazaar price makes the whole flip unpriceable rather than
 * being skipped. Dropping it would understate material cost and therefore
 * *overstate* profit, which is the one direction that invents flips that do not
 * exist — the opposite of the craft calculator, where an omitted component only
 * ever makes a listing look worse than it is.
 */
export function valueForgeFlip(
  bz: BazaarPrices,
  recipe: ForgeRecipe,
  lbin: Map<string, number>,
  names: Map<string, string>,
  opts: ForgeOptions = {},
): ForgeFlip {
  const { quickForge = 0, bazaarTax = "base", sellMode = "offer" } = opts

  const inputs: ForgeCostLine[] = recipe.inputs.map((ing) => {
    if (ing.id === COIN_ID) {
      return { id: ing.id, qty: ing.qty, unit: 1, total: ing.qty, source: "coins", note: "coins" }
    }

    // Plenty of forge materials are auction-only — drill parts, beacons,
    // crystals, Goblin Omelettes. Without the auction fallback those recipes
    // are unpriceable, which silently hides most of the interesting half of
    // the forge.
    const bazaarUnit = bz.price(ing.id, "instabuy")
    const unit = bazaarUnit ?? lbin.get(ing.id) ?? null
    const source = bazaarUnit !== null ? "bazaar" : unit !== null ? "auction" : null

    return {
      id: ing.id,
      qty: ing.qty,
      unit,
      total: unit === null ? null : unit * ing.qty,
      source,
      note:
        unit === null
          ? unpricedNote(bz, ing.id)
          : source === "auction"
            ? "AH lbin"
            : undefined,
    }
  })

  const unpriced = inputs.filter((l) => l.total === null).map((l) => l.id)
  const materialCost =
    unpriced.length > 0 ? null : inputs.reduce((sum, l) => sum + (l.total ?? 0), 0)

  // AH lowest-BIN is the realistic sale price for equipment; Bazaar goods have
  // no AH presence and sell through the order book instead.
  const ahUnit = lbin.get(recipe.output) ?? null
  const bazaarAlternative = {
    offer: bz.price(recipe.output, "sellOffer"),
    instant: bz.price(recipe.output, "instasell"),
  }
  const bzUnit = sellMode === "offer" ? bazaarAlternative.offer : bazaarAlternative.instant

  let saleGross: number | null = null
  let saleNet: number | null = null
  let saleSource: SaleSource | null = null

  if (ahUnit !== null) {
    saleGross = ahUnit * recipe.count
    // Tax is tiered on the price of a single listing, so it is charged per unit
    // rather than on the stack total.
    saleNet = auctionNetProceeds(ahUnit) * recipe.count
    saleSource = "auction"
  } else if (bzUnit !== null) {
    saleGross = bzUnit * recipe.count
    saleNet = bazaarNetProceeds(bzUnit, bazaarTax) * recipe.count
    saleSource = "bazaar"
  }

  const profit = materialCost !== null && saleNet !== null ? saleNet - materialCost : null
  const hours = (recipe.seconds * quickForgeMultiplier(quickForge)) / 3600

  return {
    recipe,
    name: names.get(recipe.output) ?? prettifyId(recipe.output),
    inputs,
    materialCost,
    saleGross,
    saleNet,
    saleSource,
    bazaarAlternative,
    profit,
    hours,
    profitPerHour: profit === null || hours <= 0 ? null : profit / hours,
    unpriced,
  }
}

/** Values every forge recipe, pets excluded. */
export function valueAllForgeFlips(
  bz: BazaarPrices,
  lbin: Map<string, number>,
  names: Map<string, string>,
  opts: ForgeOptions = {},
): ForgeFlip[] {
  return FORGE_RECIPES.filter((r) => !isPetId(r.output)).map((r) =>
    valueForgeFlip(bz, r, lbin, names, opts),
  )
}

/** `REFINED_MITHRIL` -> `Refined Mithril`, for outputs missing from the items resource. */
export function prettifyId(id: string): string {
  return id
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ")
}

export function formatForgeTime(hours: number): string {
  if (hours < 1 / 60) return `${Math.round(hours * 3600)}s`
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours < 24) return `${+hours.toFixed(1)}h`
  return `${+(hours / 24).toFixed(1)}d`
}
