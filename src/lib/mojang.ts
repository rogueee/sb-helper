/**
 * UUID -> IGN resolution for auction sellers.
 *
 * The Hypixel auction API only ever gives up the seller's player UUID, never
 * a name — but the in-game AH search (`/ah <name>`) takes a name, not a UUID.
 * playerdb.co proxies Mojang's session server with CORS enabled, which
 * Mojang's own endpoints are not, so it is the one that can be called
 * directly from the browser. Names are cached in IndexedDB since a UUID's
 * name essentially never changes.
 */
import { idbGet, idbSet } from "./idb"

const NAME_TTL_MS = 30 * 24 * 60 * 60 * 1000

interface PlayerDbResponse {
  success: boolean
  data?: { player?: { username?: string } }
}

const inflight = new Map<string, Promise<string | null>>()

export async function resolvePlayerName(uuid: string): Promise<string | null> {
  const cacheKey = `player-name:${uuid}`
  const cached = await idbGet<string>(cacheKey, NAME_TTL_MS)
  if (cached) return cached

  const running = inflight.get(uuid)
  if (running) return running

  const promise = (async () => {
    try {
      const res = await fetch(`https://playerdb.co/api/player/minecraft/${uuid}`)
      if (!res.ok) return null
      const json: PlayerDbResponse = await res.json()
      const name = json.data?.player?.username
      if (!name) return null
      await idbSet(cacheKey, name)
      return name
    } catch {
      return null
    } finally {
      inflight.delete(uuid)
    }
  })()

  inflight.set(uuid, promise)
  return promise
}
