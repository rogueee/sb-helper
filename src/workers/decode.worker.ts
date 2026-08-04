/// <reference lib="webworker" />
/**
 * Decodes auction `item_bytes` off the main thread.
 *
 * Only search candidates are sent here — a few hundred per query rather than
 * the full 50k index — so this stays well under a frame budget while keeping
 * gunzip and NBT parsing away from the UI thread entirely.
 */
import { decodeItemBytes, type ExtraAttributes } from "../lib/nbt"

export interface DecodeRequest {
  id: number
  items: { uuid: string; itemBytes: string }[]
}

export interface DecodeResponse {
  id: number
  results: { uuid: string; extra: ExtraAttributes | null }[]
}

self.onmessage = async (event: MessageEvent<DecodeRequest>) => {
  const { id, items } = event.data
  const results = await Promise.all(
    items.map(async ({ uuid, itemBytes }) => ({
      uuid,
      extra: await decodeItemBytes(itemBytes),
    })),
  )
  ;(self as unknown as Worker).postMessage({ id, results } satisfies DecodeResponse)
}
