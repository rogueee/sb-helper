/**
 * Turns a listing's decoded ExtraAttributes into a priced component breakdown.
 *
 * Guiding rule: never let an unknown modifier silently vanish. Anything we
 * cannot price is still emitted as a line with `total: null`, so a total is
 * always either complete or visibly marked incomplete. A quietly understated
 * craft cost would make a bad listing look like a bargain, which is exactly the
 * mistake this tool exists to prevent.
 */
import type { ExtraAttributes, NbtValue } from "../nbt"
import type { SkyblockItem } from "../hypixel"
import { unpricedNote, type BazaarPrices } from "./bazaar"
import { enchantBaseName, isUltimateEnchant, priceEnchantments } from "./enchants"
import { priceStars, priceDungeonConversion, prettyId, titleCase } from "./essence"
import { priceGemstones } from "./gemstones"
import reforgeStones from "@/data/reforge-stones.json"
import basicReforges from "@/data/reforge-basic.json"

export type CostGroup =
  | "enchants"
  | "stars"
  | "gems"
  | "reforge"
  | "upgrades"
  | "other"

export interface CostLine {
  label: string
  productId?: string
  quantity: number
  unit: number | null
  total: number | null
  group: CostGroup
  note?: string
  /** Tints the line; ultimate enchants read as light purple in game. */
  accent?: "ultimate"
}

export interface Valuation {
  itemId: string
  lines: CostLine[]
  /** Sum of every line we could price. */
  componentTotal: number
  /** Lines we could not price; a non-empty list means componentTotal is a floor. */
  unpriced: CostLine[]
  /** Pets carry their value in level/xp/candy, which this tool does not model. */
  isPet: boolean
}

/**
 * Blacksmith cost for a stone-free reforge, by rarity. These are fixed coin
 * sinks rather than anything the API publishes.
 */
const BASIC_REFORGE_COST: Record<string, number> = {
  COMMON: 250,
  UNCOMMON: 500,
  RARE: 1000,
  EPIC: 2500,
  LEGENDARY: 5000,
  MYTHIC: 10000,
  SUPREME: 10000,
  SPECIAL: 10000,
  VERY_SPECIAL: 10000,
  DIVINE: 10000,
}

/** Modifiers that map straight to a single Bazaar product, keyed by NBT field. */
const COUNTED_CONSUMABLES: Record<string, { productId: string; label: string }> = {
  art_of_war_count: { productId: "THE_ART_OF_WAR", label: "The Art of War" },
  artOfPeaceApplied: { productId: "THE_ART_OF_PEACE", label: "The Art of Peace" },
  wood_singularity_count: { productId: "WOOD_SINGULARITY", label: "Wood Singularity" },
  mana_disintegrator_count: { productId: "MANA_DISINTEGRATOR", label: "Mana Disintegrator" },
  jalapeno_count: { productId: "JALAPENO_BOOK", label: "Jalapeño Book" },
  tuned_transmission: { productId: "TRANSMISSION_TUNER", label: "Transmission Tuner" },
}

/** Drill components, stored as item ids directly in NBT. */
const DRILL_PARTS = ["drill_part_engine", "drill_part_fuel_tank", "drill_part_upgrade_module"]

/** Known-unpriceable modifiers: real cost, but not sold on the Bazaar. */
const AH_ONLY_NOTE = "auction-only, not priced"

function num(v: NbtValue | undefined): number {
  return typeof v === "number" ? v : 0
}

function simpleLine(
  bz: BazaarPrices,
  productId: string,
  label: string,
  quantity: number,
  group: CostGroup,
): CostLine {
  const unit = bz.price(productId, "instabuy")
  return {
    label,
    productId,
    quantity,
    unit,
    total: unit === null ? null : unit * quantity,
    group,
    note: unit === null ? unpricedNote(bz, productId) : undefined,
  }
}

function priceReforge(bz: BazaarPrices, modifier: string, tier: string | undefined): CostLine {
  const stone = (reforgeStones as Record<string, { stone: string; name: string }>)[modifier]
  if (stone) {
    return simpleLine(bz, stone.stone, `${stone.name} (${prettyId(stone.stone)})`, 1, "reforge")
  }

  const basic = (basicReforges as Record<string, { name: string }>)[modifier]
  if (basic) {
    const coins = BASIC_REFORGE_COST[(tier ?? "").toUpperCase()] ?? null
    return {
      label: `${basic.name} reforge`,
      quantity: 1,
      unit: coins,
      total: coins,
      group: "reforge",
      note: coins === null ? "blacksmith cost unknown for this rarity" : "blacksmith, coins only",
    }
  }

  return {
    label: `${titleCase(modifier)} reforge`,
    quantity: 1,
    unit: null,
    total: null,
    group: "reforge",
    note: "unrecognised reforge",
  }
}

export function valuate(
  bz: BazaarPrices,
  extra: ExtraAttributes,
  item: SkyblockItem | undefined,
): Valuation {
  const itemId = extra.id ?? "UNKNOWN"
  const lines: CostLine[] = []

  // --- Enchantments -------------------------------------------------------
  if (extra.enchantments) {
    for (const e of priceEnchantments(bz, extra.enchantments)) {
      lines.push({
        // The "Ultimate" prefix is dropped — it is a namespace, not part of the
        // name anyone uses — and the line is tinted instead, matching how the
        // game itself distinguishes them.
        label: `${titleCase(enchantBaseName(e.enchant))} ${e.level}`,
        productId: e.productId,
        quantity: e.boughtQty ?? 1,
        unit: e.total !== null && e.boughtQty ? e.total / e.boughtQty : e.total,
        total: e.total,
        group: "enchants",
        note: e.note,
        accent: isUltimateEnchant(e.enchant) ? "ultimate" : undefined,
      })
    }
  }

  // --- Stars / essence ----------------------------------------------------
  const stars = Math.max(num(extra.upgrade_level), num(extra.dungeon_item_level))
  for (const line of priceStars(bz, item, stars)) {
    lines.push({ ...line, group: "stars" })
  }

  // Dungeonising a normal item burns essence before any stars are applied.
  if (extra.dungeon_item_level !== undefined) {
    const conv = priceDungeonConversion(bz, item)
    if (conv) lines.push({ ...conv, label: `${conv.label} (dungeon conversion)`, group: "stars" })
  }

  // --- Gemstones ----------------------------------------------------------
  for (const line of priceGemstones(bz, item, extra.gems)) {
    lines.push({
      label: line.label,
      productId: line.productId,
      quantity: line.quantity,
      unit: line.unit,
      total: line.total,
      group: "gems",
      note: line.note,
    })
  }

  // --- Recombobulator -----------------------------------------------------
  const recombs = num(extra.rarity_upgrades)
  if (recombs > 0) {
    lines.push(simpleLine(bz, "RECOMBOBULATOR_3000", "Recombobulator 3000", recombs, "upgrades"))
  }

  // --- Potato books -------------------------------------------------------
  const potatoes = num(extra.hot_potato_count)
  if (potatoes > 0) {
    // The first 10 are Hot Potato Books; anything beyond is Fuming.
    const hot = Math.min(potatoes, 10)
    const fuming = Math.max(potatoes - 10, 0)
    lines.push(simpleLine(bz, "HOT_POTATO_BOOK", "Hot Potato Book", hot, "upgrades"))
    if (fuming > 0) {
      lines.push(simpleLine(bz, "FUMING_POTATO_BOOK", "Fuming Potato Book", fuming, "upgrades"))
    }
  }

  // --- Reforge ------------------------------------------------------------
  if (typeof extra.modifier === "string" && extra.modifier) {
    lines.push(priceReforge(bz, extra.modifier, item?.tier))
  }

  // --- Simple counted consumables ----------------------------------------
  for (const [field, def] of Object.entries(COUNTED_CONSUMABLES)) {
    const n = num(extra[field])
    if (n > 0) lines.push(simpleLine(bz, def.productId, def.label, n, "upgrades"))
  }

  // --- Ability scrolls ----------------------------------------------------
  if (Array.isArray(extra.ability_scroll)) {
    for (const scroll of extra.ability_scroll) {
      if (typeof scroll !== "string") continue
      lines.push(simpleLine(bz, scroll, prettyId(scroll), 1, "upgrades"))
    }
  }

  // --- Drill parts --------------------------------------------------------
  for (const field of DRILL_PARTS) {
    const part = extra[field]
    if (typeof part !== "string" || !part) continue
    lines.push(simpleLine(bz, part, prettyId(part), 1, "upgrades"))
  }

  // --- Modifiers that are real costs but not Bazaar-tradeable -------------
  if (typeof extra.talisman_enrichment === "string") {
    lines.push({
      label: `${titleCase(extra.talisman_enrichment)} Enrichment`,
      quantity: 1,
      unit: null,
      total: null,
      group: "other",
      note: AH_ONLY_NOTE,
    })
  }

  const runes = extra.runes
  if (runes && typeof runes === "object" && !Array.isArray(runes)) {
    for (const [rune, level] of Object.entries(runes)) {
      lines.push({
        label: `${titleCase(rune)} Rune ${num(level)}`,
        quantity: 1,
        unit: null,
        total: null,
        group: "other",
        note: AH_ONLY_NOTE,
      })
    }
  }

  const attributes = extra.attributes
  if (attributes && typeof attributes === "object" && !Array.isArray(attributes)) {
    for (const [attr, level] of Object.entries(attributes)) {
      lines.push({
        label: `${titleCase(attr)} ${num(level)}`,
        quantity: 1,
        unit: null,
        total: null,
        group: "other",
        note: AH_ONLY_NOTE,
      })
    }
  }

  const thunder = num(extra.thunder_charge)
  if (thunder > 0) {
    lines.push({
      label: "Thunder Charge",
      quantity: thunder,
      unit: null,
      total: null,
      group: "other",
      note: AH_ONLY_NOTE,
    })
  }

  const unpriced = lines.filter((l) => l.total === null)
  const componentTotal = lines.reduce((sum, l) => sum + (l.total ?? 0), 0)

  return {
    itemId,
    lines,
    componentTotal,
    unpriced,
    isPet: extra.petInfo !== undefined || itemId === "PET",
  }
}
