/**
 * Lowest BIN price per item id.
 *
 * The auction index holds ~50k listings whose real item id lives inside gzipped
 * NBT, so building an lbin table for every item would mean decoding all of
 * them. The forge tab needs it for barely a hundred outputs, so the same trick
 * the craft search uses applies: narrow by plaintext display name first, decode
 * only the cheapest few candidates per item, and let the decoded id be the
 * authority on what actually matched.
 *
 * Only the cheapest candidates get decoded because lbin is a minimum — once the
 * cheapest listings for a name are confirmed, nothing more expensive can change
 * the answer.
 */
import { decodeListings, type AuctionIndex, type Listing } from "./auctionIndex"

/** How many of the cheapest name-matching listings to decode per item. */
const CANDIDATES_PER_ITEM = 8

/**
 * Lowest BIN for each requested item id.
 *
 * Ids with no live BIN listing are simply absent from the map, which callers
 * must treat as "no auction price" rather than free.
 */
export async function buildLbin(
  index: AuctionIndex,
  targets: { id: string; name: string }[],
): Promise<Map<string, number>> {
  // Several ids can share a display name (the four Drill Engines, say), so a
  // name maps to a set and the decoded id decides which one a listing is.
  const byName = new Map<string, string[]>()
  for (const t of targets) {
    if (!t.name) continue
    const key = t.name.toLowerCase()
    const ids = byName.get(key)
    if (ids) ids.push(t.id)
    else byName.set(key, [t.id])
  }
  if (byName.size === 0) return new Map()

  const wanted = new Set(targets.map((t) => t.id))

  const bins = index.listings.filter((l) => l.bin)
  const candidates = new Map<string, Listing>()

  for (const [name] of byName) {
    const matches = bins
      .filter((l) => l.haystack.includes(name))
      .sort((a, b) => a.price - b.price)
      .slice(0, CANDIDATES_PER_ITEM)
    // A listing can match two names ("Drill Engine" and "Amber Polished Drill
    // Engine"); dedupe so it is decoded once.
    for (const m of matches) candidates.set(m.uuid, m)
  }
  if (candidates.size === 0) return new Map()

  const decoded = await decodeListings([...candidates.values()])

  const lbin = new Map<string, number>()
  for (const listing of decoded) {
    const id = listing.extra.id
    if (!id || !wanted.has(id)) continue
    const current = lbin.get(id)
    if (current === undefined || listing.price < current) lbin.set(id, listing.price)
  }
  return lbin
}
