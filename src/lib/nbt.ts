/**
 * Minimal NBT reader for Hypixel auction `item_bytes`.
 *
 * Auction listings carry their per-item modifiers (enchants, stars, gems,
 * recombobulator, ...) only inside a base64 + gzip + NBT blob. We need a handful
 * of fields out of it and nothing else, so a purpose-built reader beats pulling
 * in a full NBT library: no dependency, and it runs fast enough to decode a few
 * hundred candidate listings per search inside a worker.
 *
 * Gzip is handled by the platform's DecompressionStream, so there is no inflate
 * implementation here either.
 */

export type NbtValue =
  | number
  | bigint
  | string
  | Uint8Array
  | NbtValue[]
  | { [key: string]: NbtValue }

const TAG_END = 0
const TAG_BYTE = 1
const TAG_SHORT = 2
const TAG_INT = 3
const TAG_LONG = 4
const TAG_FLOAT = 5
const TAG_DOUBLE = 6
const TAG_BYTE_ARRAY = 7
const TAG_STRING = 8
const TAG_LIST = 9
const TAG_COMPOUND = 10
const TAG_INT_ARRAY = 11
const TAG_LONG_ARRAY = 12

/** Guards against a malformed blob driving unbounded allocation. */
const MAX_ELEMENTS = 1_000_000

class NbtReader {
  private view: DataView
  private bytes: Uint8Array
  private pos = 0
  private static decoder = new TextDecoder("utf-8")

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  private u1(): number {
    return this.view.getUint8(this.pos++)
  }

  private u2(): number {
    const v = this.view.getUint16(this.pos)
    this.pos += 2
    return v
  }

  private i4(): number {
    const v = this.view.getInt32(this.pos)
    this.pos += 4
    return v
  }

  private str(): string {
    const len = this.u2()
    const s = NbtReader.decoder.decode(this.bytes.subarray(this.pos, this.pos + len))
    this.pos += len
    return s
  }

  private count(): number {
    const n = this.i4()
    if (n < 0 || n > MAX_ELEMENTS) throw new Error(`NBT: implausible element count ${n}`)
    return n
  }

  payload(tag: number): NbtValue {
    switch (tag) {
      case TAG_BYTE:
        return this.view.getInt8(this.pos++)
      case TAG_SHORT: {
        const v = this.view.getInt16(this.pos)
        this.pos += 2
        return v
      }
      case TAG_INT:
        return this.i4()
      case TAG_LONG: {
        const v = this.view.getBigInt64(this.pos)
        this.pos += 8
        return v
      }
      case TAG_FLOAT: {
        const v = this.view.getFloat32(this.pos)
        this.pos += 4
        return v
      }
      case TAG_DOUBLE: {
        const v = this.view.getFloat64(this.pos)
        this.pos += 8
        return v
      }
      case TAG_BYTE_ARRAY: {
        const n = this.count()
        const v = this.bytes.subarray(this.pos, this.pos + n)
        this.pos += n
        return v
      }
      case TAG_STRING:
        return this.str()
      case TAG_LIST: {
        const elemTag = this.u1()
        const n = this.count()
        // An empty list is encoded with TAG_END as its element type.
        if (elemTag === TAG_END) return []
        const out: NbtValue[] = new Array(n)
        for (let i = 0; i < n; i++) out[i] = this.payload(elemTag)
        return out
      }
      case TAG_COMPOUND: {
        const out: Record<string, NbtValue> = {}
        for (;;) {
          const t = this.u1()
          if (t === TAG_END) return out
          out[this.str()] = this.payload(t)
        }
      }
      case TAG_INT_ARRAY: {
        const n = this.count()
        const out: NbtValue[] = new Array(n)
        for (let i = 0; i < n; i++) out[i] = this.i4()
        return out
      }
      case TAG_LONG_ARRAY: {
        const n = this.count()
        const out: NbtValue[] = new Array(n)
        for (let i = 0; i < n; i++) {
          out[i] = this.view.getBigInt64(this.pos)
          this.pos += 8
        }
        return out
      }
      default:
        throw new Error(`NBT: unknown tag ${tag} at offset ${this.pos - 1}`)
    }
  }

  root(): NbtValue {
    const tag = this.u1()
    if (tag === TAG_END) return {}
    this.str() // root name, always empty in practice
    return this.payload(tag)
  }
}

export function parseNbt(bytes: Uint8Array): NbtValue {
  return new NbtReader(bytes).root()
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Every modifier we know how to read off a listing. Fields are absent when unset. */
export interface ExtraAttributes {
  id?: string
  uuid?: string
  /** Reforge, lowercase (e.g. "fierce"). */
  modifier?: string
  /** Lowercase enchant name -> level, e.g. { protection: 6 }. */
  enchantments?: Record<string, number>
  /** Number of Recombobulator applications. */
  rarity_upgrades?: number
  /** Hot Potato + Fuming Potato books applied. */
  hot_potato_count?: number
  /** Master/normal star level. */
  upgrade_level?: number
  dungeon_item_level?: number
  gems?: Record<string, NbtValue>
  runes?: Record<string, number>
  talisman_enrichment?: string
  attributes?: Record<string, number>
  art_of_war_count?: number
  artOfPeaceApplied?: number
  wood_singularity_count?: number
  mana_disintegrator_count?: number
  thunder_charge?: number
  ability_scroll?: string[]
  /** Present on pets; used to exclude them from the craft calculator. */
  petInfo?: string | Record<string, NbtValue>
  [key: string]: NbtValue | undefined
}

/**
 * Decodes an auction's `item_bytes` down to its ExtraAttributes.
 * Returns null when the blob is unreadable rather than throwing, so one bad
 * listing cannot abort a whole page of results.
 */
export async function decodeItemBytes(itemBytes: string): Promise<ExtraAttributes | null> {
  try {
    const nbt = parseNbt(await gunzip(base64ToBytes(itemBytes)))
    // Shape: { i: [ { tag: { ExtraAttributes: {...} } } ] }
    const list = (nbt as Record<string, NbtValue>)?.i
    const first = Array.isArray(list) ? list[0] : undefined
    const tag = (first as Record<string, NbtValue>)?.tag as Record<string, NbtValue> | undefined
    const extra = tag?.ExtraAttributes
    if (!extra || typeof extra !== "object" || Array.isArray(extra)) return null
    return extra as ExtraAttributes
  } catch {
    return null
  }
}
