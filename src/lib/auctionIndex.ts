/**
 * Client-side auction house index.
 *
 * Hypixel offers no server-side filter: finding every listing of one item means
 * holding all ~50k active auctions. The sweep is ~120 MB, which is why it sits
 * behind an explicit user action rather than running on page load.
 *
 * The cost that would actually hurt — gunzip + NBT parse of every listing — is
 * avoided entirely. `item_name` and `extra` are plaintext in the page JSON, so a
 * search narrows 50k listings to a few hundred candidates on string matching
 * first, and only those get decoded. That turns a ~30 s operation into a ~1 s one.
 */
import { fetchAuctionPage, type RawAuction } from "./hypixel"
import { idbGet, idbSet } from "./idb"
import type { ExtraAttributes } from "./nbt"
import type { DecodeRequest, DecodeResponse } from "@/workers/decode.worker"

/** Trimmed listing — everything the UI needs, plus the blob for lazy decoding. */
export interface Listing {
  uuid: string
  name: string
  /** Lowercased `extra` field, pre-normalised for candidate matching. */
  haystack: string
  tier: string
  price: number
  bin: boolean
  end: number
  /** Seller's player UUID, for linking out to their other listings. */
  auctioneer: string
  itemBytes: string
}

export interface AuctionIndex {
  listings: Listing[]
  lastUpdated: number
  fetchedAt: number
}

export interface SweepProgress {
  done: number
  total: number
}

// Versioned: a cached index written before `auctioneer` existed would silently
// yield rows with no seller link. Bumping costs one re-sweep and avoids that.
const INDEX_CACHE_KEY = "auctions:index:v2"
/** Hypixel refreshes auctions about once a minute; five minutes is still useful. */
const INDEX_TTL_MS = 5 * 60 * 1000
/** Enough parallelism to saturate a connection without tripping rate limits. */
const CONCURRENCY = 8

function toListing(a: RawAuction): Listing {
  return {
    uuid: a.uuid,
    name: a.item_name,
    haystack: `${a.item_name} ${a.extra}`.toLowerCase(),
    tier: a.tier,
    // For a BIN, starting_bid is the price; for an auction, the live bid.
    price: a.bin ? a.starting_bid : Math.max(a.highest_bid_amount, a.starting_bid),
    bin: a.bin,
    end: a.end,
    auctioneer: a.auctioneer,
    itemBytes: a.item_bytes,
  }
}

/**
 * Fetches every auction page. Reports progress as pages land so the UI can show
 * real movement across what is a slow operation.
 */
export async function sweepAuctions(
  onProgress?: (p: SweepProgress) => void,
  signal?: AbortSignal,
): Promise<AuctionIndex> {
  const first = await fetchAuctionPage(0, signal)
  const total = first.totalPages

  const listings: Listing[] = first.auctions.map(toListing)
  let done = 1
  onProgress?.({ done, total })

  const queue: number[] = []
  for (let p = 1; p < total; p++) queue.push(p)

  async function worker() {
    for (;;) {
      const page = queue.shift()
      if (page === undefined) return
      try {
        const res = await fetchAuctionPage(page, signal)
        for (const a of res.auctions) listings.push(toListing(a))
      } catch (err) {
        if (signal?.aborted) throw err
        // One failed page out of fifty degrades coverage slightly; aborting the
        // whole sweep over it would be worse.
        console.warn(`Auction page ${page} skipped:`, err)
      }
      done++
      onProgress?.({ done, total })
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker))

  const index: AuctionIndex = {
    listings,
    lastUpdated: first.lastUpdated,
    fetchedAt: Date.now(),
  }
  await idbSet(INDEX_CACHE_KEY, index)
  return index
}

/** Returns a cached index if one is recent enough to be worth using. */
export async function loadCachedIndex(): Promise<AuctionIndex | null> {
  return idbGet<AuctionIndex>(INDEX_CACHE_KEY, INDEX_TTL_MS)
}

/* -------------------------------------------------------------------------- */
/* Search                                                                     */
/* -------------------------------------------------------------------------- */

export interface DecodedListing extends Listing {
  extra: ExtraAttributes
}

let workerInstance: Worker | null = null
let nextRequestId = 1

function getWorker(): Worker {
  workerInstance ??= new Worker(new URL("../workers/decode.worker.ts", import.meta.url), {
    type: "module",
  })
  return workerInstance
}

function decodeBatch(items: { uuid: string; itemBytes: string }[]) {
  const worker = getWorker()
  const id = nextRequestId++

  return new Promise<DecodeResponse["results"]>((resolve, reject) => {
    const onMessage = (event: MessageEvent<DecodeResponse>) => {
      if (event.data.id !== id) return
      worker.removeEventListener("message", onMessage)
      worker.removeEventListener("error", onError)
      resolve(event.data.results)
    }
    const onError = (event: ErrorEvent) => {
      worker.removeEventListener("message", onMessage)
      worker.removeEventListener("error", onError)
      reject(event.error ?? new Error("decode worker failed"))
    }
    worker.addEventListener("message", onMessage)
    worker.addEventListener("error", onError)
    worker.postMessage({ id, items } satisfies DecodeRequest)
  })
}

/**
 * Decodes a batch of listings, dropping any whose NBT could not be read.
 *
 * A malformed blob is skipped rather than thrown on: one bad listing out of
 * hundreds should not cost the user the whole result.
 */
export async function decodeListings(candidates: Listing[]): Promise<DecodedListing[]> {
  if (candidates.length === 0) return []

  const decoded = await decodeBatch(
    candidates.map((c) => ({ uuid: c.uuid, itemBytes: c.itemBytes })),
  )
  const byUuid = new Map(decoded.map((d) => [d.uuid, d.extra]))

  return candidates
    .map((c) => ({ ...c, extra: byUuid.get(c.uuid) ?? null }))
    .filter((c): c is DecodedListing => c.extra !== null)
}

/**
 * All listings of one item id.
 *
 * `displayName` narrows the field cheaply before any decoding; the decoded
 * `ExtraAttributes.id` is then the authority, so reforge prefixes, star symbols
 * and shared display names cannot produce a false match.
 */
export async function findListings(
  index: AuctionIndex,
  itemId: string,
  displayName: string,
  opts: { binOnly?: boolean; limit?: number } = {},
): Promise<DecodedListing[]> {
  const { binOnly = true, limit = 400 } = opts
  const needle = displayName.toLowerCase()

  const candidates = index.listings
    .filter((l) => (binOnly ? l.bin : true) && l.haystack.includes(needle))
    .sort((a, b) => a.price - b.price)
    // Cheapest listings are the interesting ones; decoding every match of a
    // common name would be wasteful.
    .slice(0, limit)

  const decoded = await decodeListings(candidates)
  return decoded.filter((c) => c.extra.id === itemId)
}

/** True when the cheap plaintext pass found more matches than `limit` allowed. */
export function countCandidates(index: AuctionIndex, displayName: string, binOnly = true): number {
  const needle = displayName.toLowerCase()
  let n = 0
  for (const l of index.listings) {
    if ((binOnly ? l.bin : true) && l.haystack.includes(needle)) n++
  }
  return n
}
