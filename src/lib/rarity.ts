/**
 * Item rarities, ordered and coloured to match the game.
 *
 * SkyBlock renders each rarity in a fixed Minecraft chat colour, so anyone using
 * this tool already reads legendary as gold and mythic as pink. Inventing a
 * palette would mean re-learning something they know by sight, so these track
 * the in-game colours — lightened only where the raw value (epic's dark purple,
 * supreme's dark red) is too dim to read on a dark surface.
 */

/** Ascending, so a rarity's index is its rank. */
export const RARITY_ORDER = [
  "COMMON",
  "UNCOMMON",
  "RARE",
  "EPIC",
  "LEGENDARY",
  "MYTHIC",
  "DIVINE",
  "SPECIAL",
  "VERY_SPECIAL",
  "SUPREME",
] as const

export type Rarity = (typeof RARITY_ORDER)[number]

const RANK = new Map<string, number>(RARITY_ORDER.map((r, i) => [r, i]))

export function rarityRank(tier: string | undefined): number {
  return RANK.get((tier ?? "").toUpperCase()) ?? -1
}

/** Tailwind text colour class per rarity, keyed off CSS vars declared in index.css. */
const RARITY_CLASS: Record<string, string> = {
  COMMON: "text-rarity-common",
  UNCOMMON: "text-rarity-uncommon",
  RARE: "text-rarity-rare",
  EPIC: "text-rarity-epic",
  LEGENDARY: "text-rarity-legendary",
  MYTHIC: "text-rarity-mythic",
  DIVINE: "text-rarity-divine",
  SPECIAL: "text-rarity-special",
  VERY_SPECIAL: "text-rarity-special",
  SUPREME: "text-rarity-supreme",
}

export function rarityColorClass(tier: string | undefined): string {
  return RARITY_CLASS[(tier ?? "").toUpperCase()] ?? "text-muted-foreground"
}

export function rarityLabel(tier: string | undefined): string {
  if (!tier) return "Unknown"
  return tier
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ")
}

/** Sorts a set of tiers into game order, unknown values last. */
export function sortRarities(tiers: Iterable<string>): string[] {
  return [...new Set(tiers)].sort((a, b) => {
    const ra = rarityRank(a)
    const rb = rarityRank(b)
    if (ra === -1 && rb === -1) return a.localeCompare(b)
    if (ra === -1) return 1
    if (rb === -1) return -1
    return ra - rb
  })
}
