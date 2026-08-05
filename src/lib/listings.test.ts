import { describe, expect, it } from "vitest"
import {
  applyFiltersAndSort,
  DEFAULT_SORT,
  EMPTY_FILTERS,
  toggleSort,
  type PricedListing,
  type SortChain,
} from "./listings"

/** Minimal stand-in — only the fields the filter/sort pipeline reads. */
function listing(
  uuid: string,
  price: number,
  craftCost: number | null,
  tier: string,
  stars: number,
): PricedListing {
  return {
    uuid,
    listing: { uuid, price } as PricedListing["listing"],
    valuation: {} as PricedListing["valuation"],
    craftCost,
    spread: craftCost === null ? null : price - craftCost,
    tier,
    stars,
  } as PricedListing & { uuid: string }
}

const rows = [
  listing("a", 500, 400, "LEGENDARY", 5), // spread +100
  listing("b", 300, 350, "MYTHIC", 0), // spread -50
  listing("c", 400, null, "LEGENDARY", 0), // spread null
  listing("d", 200, 190, "DIVINE", 10), // spread +10
]

const ids = (r: PricedListing[]) => r.map((p) => p.listing.uuid)

describe("applyFiltersAndSort", () => {
  it("sorts by price ascending and descending", () => {
    expect(ids(applyFiltersAndSort(rows, EMPTY_FILTERS, [{ key: "price", direction: "asc" }])))
      .toEqual(["d", "b", "c", "a"])
    expect(ids(applyFiltersAndSort(rows, EMPTY_FILTERS, [{ key: "price", direction: "desc" }])))
      .toEqual(["a", "c", "b", "d"])
  })

  it("sorts by spread with the best deal first", () => {
    const sorted = applyFiltersAndSort(rows, EMPTY_FILTERS, [{ key: "spread", direction: "asc" }])
    // b is the only negative spread, so it leads.
    expect(ids(sorted)[0]).toBe("b")
  })

  // Unpriceable rows carry no information for the column being sorted, so they
  // belong at the bottom either way rather than dominating a descending sort.
  it("keeps unpriceable rows last in both directions", () => {
    for (const direction of ["asc", "desc"] as const) {
      const sorted = applyFiltersAndSort(rows, EMPTY_FILTERS, [{ key: "spread", direction }])
      expect(ids(sorted).at(-1)).toBe("c")
    }
  })

  it("filters by rarity", () => {
    const filters = { rarities: new Set(["LEGENDARY"]), stars: new Set<number>(), priceRange: null }
    const out = applyFiltersAndSort(rows, filters, [{ key: "price", direction: "asc" }])
    expect(ids(out)).toEqual(["c", "a"])
  })

  it("filters by star count, treating 0 stars as a real choice", () => {
    const filters = { rarities: new Set<string>(), stars: new Set([0]), priceRange: null }
    const out = applyFiltersAndSort(rows, filters, [{ key: "price", direction: "asc" }])
    expect(ids(out)).toEqual(["b", "c"])
  })

  it("combines rarity and star filters as an intersection", () => {
    const filters = { rarities: new Set(["LEGENDARY"]), stars: new Set([0]), priceRange: null }
    const out = applyFiltersAndSort(rows, filters, [{ key: "price", direction: "asc" }])
    expect(ids(out)).toEqual(["c"])
  })

  it("filters by price range, inclusive of both bounds", () => {
    const filters = { rarities: new Set<string>(), stars: new Set<number>(), priceRange: { min: 300, max: 400 } }
    const out = applyFiltersAndSort(rows, filters, [{ key: "price", direction: "asc" }])
    expect(ids(out)).toEqual(["b", "c"])
  })

  it("returns everything when no filter is set", () => {
    const out = applyFiltersAndSort(rows, EMPTY_FILTERS, [{ key: "price", direction: "asc" }])
    expect(out).toHaveLength(4)
  })

  it("does not mutate the input array", () => {
    const before = ids(rows)
    applyFiltersAndSort(rows, EMPTY_FILTERS, [{ key: "price", direction: "desc" }])
    expect(ids(rows)).toEqual(before)
  })
})

describe("applyFiltersAndSort — combined keys", () => {
  // Price and spread disagree on purpose: "cheap" is the cheapest listing but
  // has the worst spread, and the good spreads climb in price.
  const mixed = [
    listing("cheap", 1000, 500, "LEGENDARY", 0), // price rank 0, spread rank 3
    listing("best", 2000, 2400, "LEGENDARY", 0), // price rank 1, spread rank 0
    listing("good", 3000, 3300, "LEGENDARY", 0), // price rank 2, spread rank 1
    listing("dear", 4000, 4200, "LEGENDARY", 0), // price rank 3, spread rank 2
  ]

  const both: SortChain = [
    { key: "price", direction: "asc" },
    { key: "spread", direction: "asc" },
  ]

  // The point of the feature: a listing that is merely decent on both beats one
  // that wins a single key outright.
  it("orders by combined rank, not by one key with the other as a tiebreaker", () => {
    expect(ids(applyFiltersAndSort(mixed, EMPTY_FILTERS, both))).toEqual([
      "best", // 1 + 0 = 1
      "cheap", // 0 + 3 = 3, ahead of "good" on the first-selected key
      "good", // 2 + 1 = 3
      "dear", // 3 + 2 = 5
    ])
    // Neither single-key ordering produces that, which is what makes the
    // combined score worth having.
    expect(ids(applyFiltersAndSort(mixed, EMPTY_FILTERS, [both[0]]))).toEqual([
      "cheap",
      "best",
      "good",
      "dear",
    ])
    expect(ids(applyFiltersAndSort(mixed, EMPTY_FILTERS, [both[1]]))).toEqual([
      "best",
      "good",
      "dear",
      "cheap",
    ])
  })

  it("gives every key equal weight regardless of selection order", () => {
    const reversed: SortChain = [both[1], both[0]]
    // Only the score matters, so flipping which key was picked first can change
    // nothing but the resolution of an exact tie.
    expect(ids(applyFiltersAndSort(mixed, EMPTY_FILTERS, reversed))).toEqual([
      "best",
      "good", // wins the tie with "cheap" now that spread was selected first
      "cheap",
      "dear",
    ])
  })

  it("applies each key's own direction", () => {
    const out = applyFiltersAndSort(mixed, EMPTY_FILTERS, [
      { key: "price", direction: "asc" },
      { key: "spread", direction: "desc" },
    ])
    // Cheap and worst-spread now agree on "cheap", which sweeps both keys.
    expect(ids(out)[0]).toBe("cheap")
  })

  // Ties on a key must not consume the whole ordering: rows sharing a value
  // share a rank, leaving the other key free to separate them.
  it("lets tied values on one key be decided by the other", () => {
    const tied = [
      listing("hi", 900, 800, "LEGENDARY", 0), // spread +100
      listing("lo", 300, 200, "LEGENDARY", 0), // spread +100
      listing("mid", 500, 400, "LEGENDARY", 0), // spread +100
    ]
    expect(ids(applyFiltersAndSort(tied, EMPTY_FILTERS, both))).toEqual(["lo", "mid", "hi"])
  })

  // An unpriceable row takes the worst rank on the key it is missing, so it can
  // still place above a fully priced row that is worse on everything else.
  // That is the honest reading of "weighted equally" — the alternative would
  // let one blank value override a key the user explicitly asked to sort on.
  it("penalises an unpriceable row on that key without excluding it", () => {
    const out = applyFiltersAndSort(rows, EMPTY_FILTERS, both)
    expect(ids(out)).toEqual(["d", "b", "c", "a"])
  })

  it("still sinks unpriceable rows to the bottom of a single-key sort", () => {
    for (const direction of ["asc", "desc"] as const) {
      const out = applyFiltersAndSort(rows, EMPTY_FILTERS, [{ key: "spread", direction }])
      expect(ids(out).at(-1)).toBe("c")
    }
  })
})

describe("toggleSort", () => {
  const chain: SortChain = [{ key: "spread", direction: "asc" }]

  it("replaces the chain on a plain click of an inactive key", () => {
    expect(toggleSort(chain, "price", false)).toEqual([{ key: "price", direction: "asc" }])
  })

  it("flips direction on a plain click of the only active key", () => {
    expect(toggleSort(chain, "spread", false)).toEqual([{ key: "spread", direction: "desc" }])
  })

  // Plain click always means "just this one", so clicking a key that is part of
  // a combined sort narrows to it rather than flipping it in place.
  it("narrows a combined sort to a single key on a plain click", () => {
    const two: SortChain = [
      { key: "spread", direction: "desc" },
      { key: "price", direction: "asc" },
    ]
    expect(toggleSort(two, "spread", false)).toEqual([{ key: "spread", direction: "asc" }])
  })

  it("adds a key to the combined sort on shift-click", () => {
    expect(toggleSort(chain, "price", true)).toEqual([
      { key: "spread", direction: "asc" },
      { key: "price", direction: "asc" },
    ])
  })

  // Three shift-clicks walk a key all the way in and back out again.
  it("cycles a key through add, reverse, then drop on repeated shift-clicks", () => {
    const added = toggleSort(chain, "price", true)
    expect(added).toEqual([
      { key: "spread", direction: "asc" },
      { key: "price", direction: "asc" },
    ])

    const reversed = toggleSort(added, "price", true)
    expect(reversed).toEqual([
      { key: "spread", direction: "asc" },
      { key: "price", direction: "desc" },
    ])

    expect(toggleSort(reversed, "price", true)).toEqual([{ key: "spread", direction: "asc" }])
  })

  it("keeps a key in place when reversing it, so the others are untouched", () => {
    const three: SortChain = [
      { key: "spread", direction: "asc" },
      { key: "price", direction: "asc" },
      { key: "craftCost", direction: "asc" },
    ]
    expect(toggleSort(three, "price", true)).toEqual([
      { key: "spread", direction: "asc" },
      { key: "price", direction: "desc" },
      { key: "craftCost", direction: "asc" },
    ])
  })

  // An empty sort would leave the table in whatever order decoding produced,
  // which reads as random. The last key wraps round instead of disappearing.
  it("never empties the sort, wrapping the last key back to ascending", () => {
    const desc: SortChain = [{ key: "spread", direction: "desc" }]
    expect(toggleSort(chain, "spread", true)).toEqual([{ key: "spread", direction: "desc" }])
    expect(toggleSort(desc, "spread", true)).toEqual([{ key: "spread", direction: "asc" }])
  })


  it("starts from a single price-ascending rule", () => {
    expect(DEFAULT_SORT).toEqual([{ key: "price", direction: "asc" }])
  })
})
