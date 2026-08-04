/**
 * Hypixel SkyBlock API clients.
 *
 * Every endpoint used here is public (no API key) and served with
 * `access-control-allow-origin: *`, so the browser calls Hypixel directly and
 * the app needs no backend of its own.
 */
import { idbGet, idbSet } from "./idb"

const BASE = "https://api.hypixel.net/v2"

/* -------------------------------------------------------------------------- */
/* Bazaar                                                                     */
/* -------------------------------------------------------------------------- */

export interface BazaarQuickStatus {
  productId: string
  /** Price you pay to buy instantly (top sell offer). */
  buyPrice: number
  buyVolume: number
  buyMovingWeek: number
  buyOrders: number
  /** Price you receive selling instantly (top buy order). */
  sellPrice: number
  sellVolume: number
  sellMovingWeek: number
  sellOrders: number
}

export interface BazaarProduct {
  product_id: string
  quick_status: BazaarQuickStatus
}

export interface BazaarResponse {
  success: boolean
  lastUpdated: number
  products: Record<string, BazaarProduct>
}

export async function fetchBazaar(): Promise<BazaarResponse> {
  const res = await fetch(`${BASE}/skyblock/bazaar`)
  if (!res.ok) throw new Error(`Bazaar request failed: ${res.status}`)
  const json: BazaarResponse = await res.json()
  if (!json.success) throw new Error("Bazaar request returned success: false")
  return json
}

/* -------------------------------------------------------------------------- */
/* Items resource                                                             */
/* -------------------------------------------------------------------------- */

export type UpgradeCost =
  | { type: "ESSENCE"; essence_type: string; amount: number }
  | { type: "ITEM"; item_id: string; amount: number }
  | { type: "COINS"; coins: number }

export interface GemstoneSlot {
  slot_type: string
  costs?: UpgradeCost[]
}

export interface SkyblockItem {
  id: string
  name: string
  tier?: string
  category?: string
  npc_sell_price?: number
  /** Essence/item cost per star, index 0 = first star. */
  upgrade_costs?: UpgradeCost[][]
  gemstone_slots?: GemstoneSlot[]
  dungeon_item_conversion_cost?: { essence_type: string; amount: number }
  can_recombobulate?: boolean
  museum?: boolean
}

export interface ItemsResponse {
  success: boolean
  lastUpdated: number
  items: SkyblockItem[]
}

const ITEMS_CACHE_KEY = "resources:items"
/** The items resource is semi-static; a day-old copy is fine and saves a 5 MB fetch. */
const ITEMS_TTL_MS = 24 * 60 * 60 * 1000

export async function fetchItems(): Promise<SkyblockItem[]> {
  const cached = await idbGet<SkyblockItem[]>(ITEMS_CACHE_KEY, ITEMS_TTL_MS)
  if (cached) return cached

  const res = await fetch(`${BASE}/resources/skyblock/items`)
  if (!res.ok) throw new Error(`Items request failed: ${res.status}`)
  const json: ItemsResponse = await res.json()
  if (!json.success) throw new Error("Items request returned success: false")

  await idbSet(ITEMS_CACHE_KEY, json.items)
  return json.items
}

/* -------------------------------------------------------------------------- */
/* Auctions                                                                   */
/* -------------------------------------------------------------------------- */

export interface RawAuction {
  uuid: string
  item_name: string
  item_lore: string
  /** Plaintext alias blob — searchable without decoding NBT. */
  extra: string
  tier: string
  category: string
  starting_bid: number
  highest_bid_amount: number
  bin: boolean
  end: number
  item_bytes: string
}

export interface AuctionPage {
  success: boolean
  page: number
  totalPages: number
  totalAuctions: number
  lastUpdated: number
  auctions: RawAuction[]
}

export async function fetchAuctionPage(page: number, signal?: AbortSignal): Promise<AuctionPage> {
  const res = await fetch(`${BASE}/skyblock/auctions?page=${page}`, { signal })
  if (!res.ok) throw new Error(`Auction page ${page} failed: ${res.status}`)
  const json: AuctionPage = await res.json()
  if (!json.success) throw new Error(`Auction page ${page} returned success: false`)
  return json
}
