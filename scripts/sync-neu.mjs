#!/usr/bin/env node
/**
 * Derives static data the Hypixel API does not expose, from the NotEnoughUpdates repo.
 *
 * Hypixel publishes no crafting recipes and no mapping from an item's NBT `modifier`
 * string back to the reforge stone that produced it. Both are needed:
 *   - compaction ratios drive the raw-vs-compacted calculator
 *   - the reforge map lets the craft calculator price a listing's reforge
 *
 * Output is small and checked in, so the app stays a static site and does not
 * depend on GitHub being reachable at runtime.
 *
 *   npm run sync:data
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { Readable } from "node:stream"
import { createGunzip } from "node:zlib"
import { extract } from "tar-stream"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = resolve(ROOT, "src/data")
const TARBALL =
  "https://codeload.github.com/NotEnoughUpdates/NotEnoughUpdates-REPO/tar.gz/refs/heads/master"

/** Pull every `items/*.json` and `constants/*.json` out of the repo tarball in one pass. */
async function fetchRepo() {
  const res = await fetch(TARBALL)
  if (!res.ok) throw new Error(`NEU tarball fetch failed: ${res.status} ${res.statusText}`)

  const items = new Map()
  const constants = new Map()
  const tar = extract()

  tar.on("entry", (header, stream, next) => {
    const m = header.name.match(/^[^/]+\/(items|constants)\/(.+)\.json$/)
    if (!m) {
      stream.resume()
      stream.on("end", next)
      return
    }
    const chunks = []
    stream.on("data", (c) => chunks.push(c))
    stream.on("end", () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"))
        ;(m[1] === "items" ? items : constants).set(m[2], parsed)
      } catch {
        // A malformed file upstream should not abort the whole sync.
      }
      next()
    })
    stream.resume()
  })

  await new Promise((ok, err) => {
    tar.on("finish", ok)
    tar.on("error", err)
    Readable.fromWeb(res.body).pipe(createGunzip()).pipe(tar)
  })

  return { items, constants }
}

const GRID = ["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3"]

/**
 * A compaction recipe is one whose grid uses a single ingredient and nothing else.
 * `"INK_SACK:16"` in 5 slots means 80 Ink Sacs; a bare `"INK_SACK"` means 1.
 * Returns { input, count } or null.
 */
function readUniformRecipe(recipe) {
  if (!recipe) return null
  let input = null
  let total = 0

  for (const slot of GRID) {
    const cell = recipe[slot]
    if (!cell) continue
    const idx = cell.lastIndexOf(":")
    // Some ids legitimately contain ':' (e.g. "PET:4"), so only treat a
    // trailing all-digit segment as a quantity.
    let id = cell
    let qty = 1
    if (idx !== -1 && /^\d+$/.test(cell.slice(idx + 1))) {
      id = cell.slice(0, idx)
      qty = Number(cell.slice(idx + 1))
    }
    if (!id) continue
    if (input === null) input = id
    else if (input !== id) return null // mixed ingredients — not a compaction
    total += qty
  }

  if (!input || total < 2) return null
  return { input, count: total }
}

/** Recipes can produce a stack (`count`/`overrideOutputCount`); normalise to per-1-output. */
function outputCount(item) {
  const n = Number(item?.recipe?.count ?? item?.recipe?.overrideOutputCount ?? 1)
  return Number.isFinite(n) && n > 0 ? n : 1
}

function buildCompaction(items) {
  /** @type {Array<{input: string, output: string, ratio: number}>} */
  const steps = []

  for (const [name, item] of items) {
    const uniform = readUniformRecipe(item.recipe)
    if (!uniform) continue
    const output = item.internalname ?? name
    if (uniform.input === output) continue // self-referential, ignore

    const ratio = uniform.count / outputCount(item)
    if (!Number.isFinite(ratio) || ratio < 2) continue
    steps.push({ input: uniform.input, output, ratio })
  }

  // Collapse duplicates, keeping the cheapest (lowest-ratio) route per pair.
  const best = new Map()
  for (const s of steps) {
    const key = `${s.input}->${s.output}`
    const prev = best.get(key)
    if (!prev || s.ratio < prev.ratio) best.set(key, s)
  }

  return [...best.values()].sort((a, b) => a.input.localeCompare(b.input) || a.output.localeCompare(b.output))
}

/**
 * NBT stores the applied reforge as a lowercase name. Two kinds exist and they
 * cost different things:
 *   - stone reforges  -> consume a purchasable reforge stone (price it from the Bazaar/AH)
 *   - basic reforges  -> blacksmith/anvil, coins only, scaled by the item's rarity
 * Emitting both means the craft calculator can tell them apart instead of
 * silently dropping every basic reforge as "unknown".
 */
function buildReforges(constants) {
  const stones = constants.get("reforgestones") ?? {}
  /** @type {Record<string, {stone: string, name: string}>} */
  const stoneMap = {}

  for (const [id, def] of Object.entries(stones)) {
    if (!def?.reforgeName) continue
    const key = def.reforgeName.toLowerCase()
    // Distinct stones occasionally share a reforge name across item types; first wins.
    if (!stoneMap[key]) stoneMap[key] = { stone: def.internalName ?? id, name: def.reforgeName }
  }

  const basic = constants.get("reforges") ?? {}
  /** @type {Record<string, {name: string}>} */
  const basicMap = {}
  for (const [id, def] of Object.entries(basic)) {
    const name = def?.reforgeName ?? id
    const key = name.toLowerCase()
    if (!stoneMap[key]) basicMap[key] = { name }
  }

  const sort = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))
  return { stoneMap: sort(stoneMap), basicMap: sort(basicMap) }
}

const { items, constants } = await fetchRepo()
if (items.size === 0) throw new Error("NEU tarball contained no items — aborting rather than writing empty data")

const compaction = buildCompaction(items)
const { stoneMap, basicMap } = buildReforges(constants)

mkdirSync(OUT, { recursive: true })
writeFileSync(resolve(OUT, "compaction.json"), JSON.stringify(compaction, null, 2) + "\n")
writeFileSync(resolve(OUT, "reforge-stones.json"), JSON.stringify(stoneMap, null, 2) + "\n")
writeFileSync(resolve(OUT, "reforge-basic.json"), JSON.stringify(basicMap, null, 2) + "\n")

console.log(`NEU items scanned : ${items.size}`)
console.log(`compaction steps  : ${compaction.length}  -> src/data/compaction.json`)
console.log(`stone reforges    : ${Object.keys(stoneMap).length}  -> src/data/reforge-stones.json`)
console.log(`basic reforges    : ${Object.keys(basicMap).length}  -> src/data/reforge-basic.json`)
