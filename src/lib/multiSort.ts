/**
 * Balanced multi-key sorting, shared by every table in the app.
 *
 * Selecting more than one key does *not* build a tiebreaker chain. Each row is
 * ranked separately on every active key and ordered by the sum of those ranks,
 * so asking for price and spread together surfaces rows that do well on both —
 * cheap *and* a good margin. A tiebreaker chain would order entirely by the
 * first key and consult the second only on exact ties, which for continuous
 * coin values essentially never happens, making the second key decorative.
 *
 * Ranks rather than raw values because keys share a unit but not a scale: one
 * 2b listing would otherwise swamp the price term and drown out everything
 * else. Rank distance is immune to outliers.
 */

export type SortDirection = "asc" | "desc"

export interface SortRuleOf<K extends string> {
  key: K
  direction: SortDirection
}

/**
 * The set of keys a table is ordered by. Rules carry equal weight, so array
 * order is presentation only — it records the order keys were selected in, and
 * resolves exact ties. Always holds at least one rule so order stays stable.
 */
export type SortChainOf<K extends string> = SortRuleOf<K>[]

function flip<K extends string>(rule: SortRuleOf<K>): SortRuleOf<K> {
  return { key: rule.key, direction: rule.direction === "asc" ? "desc" : "asc" }
}

/**
 * Click semantics for a sort chip.
 *
 * Plain click means "just this one": the key becomes the sole sort, or flips if
 * it already was. Shift-click cycles a key through the combined sort — add,
 * reverse, then drop.
 *
 * `initial` is the direction a key starts in, because the useful end differs by
 * key: cheapest price first, but highest profit first. Starting everything
 * ascending would make half the chips show the least interesting rows.
 */
export function toggleSortRule<K extends string>(
  chain: SortChainOf<K>,
  key: K,
  append: boolean,
  initial: SortDirection = "asc",
): SortChainOf<K> {
  const index = chain.findIndex((r) => r.key === key)

  if (append) {
    if (index === -1) return [...chain, { key, direction: initial }]
    if (chain[index].direction === initial) {
      const next = [...chain]
      next[index] = flip(next[index])
      return next
    }
    // Dropping the only key would leave the table in whatever order the data
    // arrived in, which reads as random. The last one wraps back to the start.
    if (chain.length === 1) return [{ key, direction: initial }]
    return chain.filter((r) => r.key !== key)
  }

  if (chain.length === 1 && index === 0) return [flip(chain[0])]
  return [{ key, direction: initial }]
}

/**
 * Positions every row for one rule, 0 = best. Equal values share the first
 * position of their group so neither gets an arbitrary edge in the combined
 * score, and rows with no value all tie for the worst position on that key
 * rather than scattering through it.
 */
function ranksFor<T, K extends string>(
  rows: T[],
  rule: SortRuleOf<K>,
  valueOf: (row: T, key: K) => number | null,
): number[] {
  const dir = rule.direction === "asc" ? 1 : -1
  const value = (i: number) => valueOf(rows[i], rule.key)

  const order = rows.map((_, i) => i)
  order.sort((a, b) => {
    const av = value(a)
    const bv = value(b)
    if (av === null && bv === null) return 0
    if (av === null) return 1
    if (bv === null) return -1
    return (av - bv) * dir
  })

  const ranks = new Array<number>(rows.length)
  for (let pos = 0; pos < order.length; pos++) {
    const prev = order[pos - 1]
    ranks[order[pos]] = pos > 0 && value(prev) === value(order[pos]) ? ranks[prev] : pos
  }
  return ranks
}

/**
 * Orders `rows` by the combined rank across every rule.
 *
 * A row with no value for a key takes the worst rank on that key. In a
 * single-key sort that puts it at the bottom in either direction, where it
 * belongs. In a combined sort it can still outrank a row that is worse on
 * everything else — which is what weighting keys equally means, and the
 * alternative would let one blank value override a key the user asked for.
 */
export function multiSort<T, K extends string>(
  rows: T[],
  chain: SortChainOf<K>,
  valueOf: (row: T, key: K) => number | null,
): T[] {
  if (chain.length === 0) return [...rows]

  const tables = chain.map((rule) => ranksFor(rows, rule, valueOf))
  const score = rows.map((_, i) => tables.reduce((sum, t) => sum + t[i], 0))

  const order = rows.map((_, i) => i)
  order.sort((a, b) => {
    if (score[a] !== score[b]) return score[a] - score[b]
    // Equal combined score: let the keys decide in selection order, so the
    // result is deterministic rather than a function of arrival order.
    for (const t of tables) {
      if (t[a] !== t[b]) return t[a] - t[b]
    }
    return a - b
  })

  return order.map((i) => rows[i])
}
