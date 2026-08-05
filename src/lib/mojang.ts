/**
 * UUID -> IGN resolution for auction sellers.
 *
 * The Hypixel auction API only ever gives up the seller's player UUID, never a
 * name — but the in-game AH search (`/ah <name>`) takes a name. Mojang's own
 * session server sends no CORS headers, so the browser cannot call it directly
 * and a proxy is required.
 *
 * crafthead.net is the primary: it is Cloudflare-backed and built to serve skin
 * lookups at volume, and 150 concurrent lookups return 150 successes. playerdb
 * starts returning 429 (`retry-after: 10`) at roughly a third of that, which is
 * what made seller names intermittently fail — so it is now only the fallback.
 * api.ashcon.app is deliberately not used: it served a name two renames stale
 * for a UUID the other three agreed on.
 */
import { idbGet, idbSet } from "./idb"

/**
 * Names are cached for a day rather than a month. A renamed seller yields an
 * `/ah` command that silently finds nobody in game, and there is no way to tell
 * from the client that it has gone stale — a day bounds how long that can last
 * while still sparing the vast majority of lookups.
 */
const NAME_TTL_MS = 24 * 60 * 60 * 1000

/** Endpoints in priority order; both are CORS-enabled and return `{ name }`. */
const SOURCES = [
  (uuid: string) => `https://crafthead.net/profile/${uuid}`,
  (uuid: string) => `https://api.minetools.eu/uuid/${uuid}`,
]

const inflight = new Map<string, Promise<string | null>>()

async function fetchName(uuid: string): Promise<string | null> {
  for (const source of SOURCES) {
    try {
      const res = await fetch(source(uuid))
      if (!res.ok) continue
      const json: { name?: string } = await res.json()
      // minetools reports a miss as `{ status: "ERR", ... }` with no name.
      if (json.name) return json.name
    } catch {
      // Network failure on one source is not a reason to skip the next.
    }
  }
  return null
}

export async function resolvePlayerName(uuid: string): Promise<string | null> {
  const cacheKey = `player-name:${uuid}`
  const cached = await idbGet<string>(cacheKey, NAME_TTL_MS)
  if (cached) return cached

  const running = inflight.get(uuid)
  if (running) return running

  const promise = (async () => {
    try {
      const name = await fetchName(uuid)
      // Only a hit is cached. Caching a miss would pin a transient outage or
      // rate-limit into place for the whole TTL.
      if (name) await idbSet(cacheKey, name)
      return name
    } finally {
      inflight.delete(uuid)
    }
  })()

  inflight.set(uuid, promise)
  return promise
}
