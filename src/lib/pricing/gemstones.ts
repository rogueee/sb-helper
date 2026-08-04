/**
 * Gemstone pricing — two distinct costs per slot.
 *
 *   1. Unlocking the slot   (coins + flawless gems, from the items resource)
 *   2. The gem sitting in it (a FINE/FLAWLESS/PERFECT gem on the Bazaar)
 *
 * NBT shape, both variants seen in the wild:
 *   { "JASPER_0": "FINE", "COMBAT_0": {"quality":"FINE"},
 *     "COMBAT_0_gem": "JASPER", "unlocked_slots": ["JASPER_0","COMBAT_0"] }
 *
 * Slots named after a gemstone imply their own type. Universal slots (COMBAT,
 * MINING, ...) accept any gem, so the fitted type is stored alongside in a
 * `<SLOT>_gem` companion key.
 */
import type { NbtValue } from "../nbt"
import type { SkyblockItem, UpgradeCost } from "../hypixel"
import { unpricedNote, type BazaarPrices } from "./bazaar"
import { prettyId, titleCase } from "./essence"

export interface GemLine {
  label: string
  productId?: string
  quantity: number
  unit: number | null
  total: number | null
  kind: "unlock" | "gem"
  note?: string
}

/** Slot types that name a specific gemstone; anything else is a universal slot. */
const GEM_TYPES = new Set([
  "RUBY",
  "AMETHYST",
  "JADE",
  "SAPPHIRE",
  "AMBER",
  "TOPAZ",
  "JASPER",
  "OPAL",
  "ONYX",
  "AQUAMARINE",
  "CITRINE",
  "PERIDOT",
])

export function gemProductId(quality: string, gemType: string): string {
  return `${quality.toUpperCase()}_${gemType.toUpperCase()}_GEM`
}

function readQuality(value: NbtValue | undefined): string | null {
  if (typeof value === "string") return value
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const q = (value as Record<string, NbtValue>).quality
    if (typeof q === "string") return q
  }
  return null
}

function parseSlotKey(key: string): { type: string; index: number } | null {
  const m = key.match(/^([A-Z_]+?)_(\d+)$/)
  if (!m) return null
  return { type: m[1], index: Number(m[2]) }
}

function priceUnlockCost(bz: BazaarPrices, cost: UpgradeCost, slotLabel: string): GemLine {
  if (cost.type === "COINS") {
    return {
      label: `${slotLabel} slot unlock`,
      quantity: 1,
      unit: cost.coins,
      total: cost.coins,
      kind: "unlock",
    }
  }
  if (cost.type === "ITEM") {
    const unit = bz.price(cost.item_id, "instabuy")
    return {
      label: `${slotLabel} slot: ${prettyId(cost.item_id)}`,
      productId: cost.item_id,
      quantity: cost.amount,
      unit,
      total: unit === null ? null : unit * cost.amount,
      kind: "unlock",
      note: unit === null ? unpricedNote(bz, cost.item_id) : undefined,
    }
  }
  const productId = `ESSENCE_${cost.essence_type.toUpperCase()}`
  const unit = bz.price(productId, "instabuy")
  return {
    label: `${slotLabel} slot: ${titleCase(cost.essence_type)} Essence`,
    productId,
    quantity: cost.amount,
    unit,
    total: unit === null ? null : unit * cost.amount,
    kind: "unlock",
    note: unit === null ? unpricedNote(bz, productId) : undefined,
  }
}

/**
 * Prices every unlocked slot and fitted gem on a listing.
 *
 * Slot unlock costs are matched positionally: `JASPER_1` is the second
 * JASPER-typed entry in the item's `gemstone_slots`, which is how the resource
 * distinguishes a free starting slot from a paid one.
 */
export function priceGemstones(
  bz: BazaarPrices,
  item: SkyblockItem | undefined,
  gems: Record<string, NbtValue> | undefined,
): GemLine[] {
  if (!gems) return []

  const lines: GemLine[] = []

  // Positional index of each slot type as declared on the item.
  const slotsByType = new Map<string, { slot_type: string; costs?: UpgradeCost[] }[]>()
  for (const slot of item?.gemstone_slots ?? []) {
    const list = slotsByType.get(slot.slot_type) ?? []
    list.push(slot)
    slotsByType.set(slot.slot_type, list)
  }

  const unlocked = Array.isArray(gems.unlocked_slots)
    ? (gems.unlocked_slots as NbtValue[]).filter((v): v is string => typeof v === "string")
    : []

  // A slot holding a gem is necessarily unlocked, even if the list omits it.
  const slotKeys = new Set<string>(unlocked)
  for (const key of Object.keys(gems)) {
    if (key === "unlocked_slots" || key.endsWith("_gem")) continue
    if (parseSlotKey(key)) slotKeys.add(key)
  }

  for (const key of [...slotKeys].sort()) {
    const parsed = parseSlotKey(key)
    if (!parsed) continue
    const { type, index } = parsed
    const slotLabel = titleCase(type)

    // 1. Unlock cost for this positional slot.
    const declared = slotsByType.get(type)?.[index]
    for (const cost of declared?.costs ?? []) {
      lines.push(priceUnlockCost(bz, cost, slotLabel))
    }

    // 2. The gem fitted into it, if any.
    const quality = readQuality(gems[key])
    if (!quality) continue

    const companion = gems[`${key}_gem`]
    const gemType = GEM_TYPES.has(type)
      ? type
      : typeof companion === "string"
        ? companion
        : null

    if (!gemType) {
      lines.push({
        label: `${slotLabel} slot gem`,
        quantity: 1,
        unit: null,
        total: null,
        kind: "gem",
        note: "gem type not recorded",
      })
      continue
    }

    const productId = gemProductId(quality, gemType)
    const unit = bz.price(productId, "instabuy")
    lines.push({
      label: `${titleCase(quality)} ${titleCase(gemType)} Gemstone`,
      productId,
      quantity: 1,
      unit,
      total: unit,
      kind: "gem",
      note: unit === null ? unpricedNote(bz, productId) : undefined,
    })
  }

  return lines
}
