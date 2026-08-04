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
 * NEU writes an ingredient as `"ID:QTY"`, or a bare `"ID"` for one.
 *
 * Quantities are not always integers in the source — forge recipes carry them as
 * `"FLAWLESS_AMBER_GEM:2.0"`. Missing the decimal form leaves the ".0" glued to
 * the id, which then matches no Bazaar product and silently drops the material
 * from the cost. Only a trailing numeric segment counts, so ids that contain a
 * colon for other reasons are left intact.
 */
function splitQty(cell) {
  const idx = cell.lastIndexOf(":")
  if (idx !== -1 && /^\d+(\.\d+)?$/.test(cell.slice(idx + 1))) {
    return { id: cell.slice(0, idx), qty: Number(cell.slice(idx + 1)) }
  }
  return { id: cell, qty: 1 }
}

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
    const { id, qty } = splitQty(cell)
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
 * Forge recipes: the Dwarven Forge turns Bazaar materials into an item after a
 * fixed wait. Hypixel publishes neither the inputs nor the duration, but NEU
 * carries both on the output item:
 *
 *   { type: "forge", inputs: ["ENCHANTED_MITHRIL:160"], count: 1,
 *     overrideOutputId: "REFINED_MITHRIL", duration: 21600 }
 *
 * `duration` is in seconds, which is what makes profit-per-hour computable.
 * Recipes without one are dropped: a forge flip ranked on time is meaningless
 * without the time, and guessing a duration would silently distort the ranking.
 */
function buildForge(items) {
  /** @type {Array<{output: string, count: number, seconds: number, inputs: Array<{id: string, qty: number}>}>} */
  const recipes = []

  for (const [name, item] of items) {
    for (const recipe of item.recipes ?? []) {
      if (recipe?.type !== "forge") continue

      const seconds = Number(recipe.duration)
      if (!Number.isFinite(seconds) || seconds <= 0) continue

      const inputs = []
      let malformed = false
      for (const cell of recipe.inputs ?? []) {
        if (typeof cell !== "string") continue
        const { id, qty } = splitQty(cell)
        if (!id || !Number.isFinite(qty) || qty <= 0) {
          malformed = true
          break
        }
        // The same material can appear in two slots; fold it into one line.
        const existing = inputs.find((i) => i.id === id)
        if (existing) existing.qty += qty
        else inputs.push({ id, qty })
      }
      if (malformed || inputs.length === 0) continue

      const count = Number(recipe.count ?? 1)
      recipes.push({
        output: recipe.overrideOutputId ?? item.internalname ?? name,
        count: Number.isFinite(count) && count > 0 ? count : 1,
        seconds,
        inputs: inputs.sort((a, b) => a.id.localeCompare(b.id)),
      })
    }
  }

  // An item can list the same forge recipe more than once across NEU files;
  // keep one per output, preferring the shortest forge time.
  const best = new Map()
  for (const r of recipes) {
    const prev = best.get(r.output)
    if (!prev || r.seconds < prev.seconds) best.set(r.output, r)
  }

  return [...best.values()].sort((a, b) => a.output.localeCompare(b.output))
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
const forge = buildForge(items)
const { stoneMap, basicMap } = buildReforges(constants)

mkdirSync(OUT, { recursive: true })
writeFileSync(resolve(OUT, "compaction.json"), JSON.stringify(compaction, null, 2) + "\n")
writeFileSync(resolve(OUT, "forge.json"), JSON.stringify(forge, null, 2) + "\n")
writeFileSync(resolve(OUT, "reforge-stones.json"), JSON.stringify(stoneMap, null, 2) + "\n")
writeFileSync(resolve(OUT, "reforge-basic.json"), JSON.stringify(basicMap, null, 2) + "\n")

console.log(`NEU items scanned : ${items.size}`)
console.log(`compaction steps  : ${compaction.length}  -> src/data/compaction.json`)
console.log(`forge recipes     : ${forge.length}  -> src/data/forge.json`)
console.log(`stone reforges    : ${Object.keys(stoneMap).length}  -> src/data/reforge-stones.json`)
console.log(`basic reforges    : ${Object.keys(basicMap).length}  -> src/data/reforge-basic.json`)
