import { describe, expect, it, vi } from "vitest"

// Small fake compaction chain, independent of the real (large) generated data,
// so this test exercises the walk/scoring logic in isolation:
//   RAW --16--> MID --2--> TOP
vi.mock("@/data/compaction.json", () => ({
  default: [
    { input: "RAW", output: "MID", ratio: 16 },
    { input: "MID", output: "TOP", ratio: 2 },
    { input: "RAW", output: "OTHER_UNPRICED", ratio: 4 },
  ],
}))

const { analyseCompaction } = await import("./compaction")
const { mockBazaar } = await import("./pricing/testUtils")

describe("analyseCompaction", () => {
  it("recommends selling raw when compacting loses value", () => {
    // 16 raw @ 10 = 160, MID sells for only 100 -> compacting loses money.
    const bz = mockBazaar({ RAW: { sell: 10 }, MID: { sell: 100 } })
    const result = analyseCompaction(bz, "RAW", "instant")
    expect(result.sellRaw).toBe(true)
    expect(result.best?.itemId).toBe("MID")
    expect(result.deltaPerRaw).toBeCloseTo(100 / 16 - 10)
  })

  it("recommends compacting when the compacted form is worth more", () => {
    // 16 raw @ 10 = 160, MID sells for 400 -> huge win compacting.
    const bz = mockBazaar({ RAW: { sell: 10 }, MID: { sell: 400 } })
    const result = analyseCompaction(bz, "RAW", "instant")
    expect(result.sellRaw).toBe(false)
    expect(result.deltaPerRaw).toBeGreaterThan(0)
  })

  it("walks multi-step chains and picks the best rung, not just the first", () => {
    // Per raw: MID = 400/16 = 25. TOP = 900/(16*2) = 28.125 -> TOP wins.
    const bz = mockBazaar({ RAW: { sell: 10 }, MID: { sell: 400 }, TOP: { sell: 900 } })
    const result = analyseCompaction(bz, "RAW", "instant")
    expect(result.best?.itemId).toBe("TOP")
    expect(result.best?.rawPerUnit).toBe(32)
  })

  it("skips rungs with no bazaar price instead of crashing", () => {
    const bz = mockBazaar({ RAW: { sell: 10 } }) // MID, OTHER_UNPRICED unpriced
    const result = analyseCompaction(bz, "RAW", "instant")
    expect(result.best).toBeNull()
    expect(result.sellRaw).toBe(true)
    expect(result.deltaPerRaw).toBeNull()
  })

  it("switches which route wins when using sell-offer pricing instead of instant", () => {
    const bz = mockBazaar({ RAW: { sell: 10, buy: 12 }, MID: { sell: 100, buy: 200 } })
    const instant = analyseCompaction(bz, "RAW", "instant")
    const offer = analyseCompaction(bz, "RAW", "offer")
    // instasell(raw)=10 vs instasell(MID)/16=6.25 -> sell raw
    expect(instant.sellRaw).toBe(true)
    // sellOffer(raw)=buyPrice=12 vs sellOffer(MID)/16 = 200/16=12.5 -> compact
    expect(offer.sellRaw).toBe(false)
  })
})
