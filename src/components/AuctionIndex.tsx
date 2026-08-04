/**
 * Loading and status UI for the client-side auction index.
 *
 * Shared by every route that needs auction prices, so the ~120 MB sweep is paid
 * once and its cached result is picked up by whichever tab is opened next.
 */
import { useCallback, useEffect, useState } from "react"
import { Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  loadCachedIndex,
  sweepAuctions,
  type AuctionIndex,
  type SweepProgress,
} from "@/lib/auctionIndex"
import { formatRelativeTime } from "@/lib/format"

export function useAuctionIndex() {
  const [index, setIndex] = useState<AuctionIndex | null>(null)
  const [progress, setProgress] = useState<SweepProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  /**
   * True until the cache lookup settles. Reading ~90 MB back out of IndexedDB
   * takes a moment, and without this the "Load the auction house" card flashes
   * up on every tab switch — inviting a second 120 MB sweep that is not needed.
   */
  const [restoring, setRestoring] = useState(true)

  useEffect(() => {
    let cancelled = false
    loadCachedIndex()
      .then((cached) => !cancelled && cached && setIndex(cached))
      .finally(() => !cancelled && setRestoring(false))
    return () => {
      cancelled = true
    }
  }, [])

  const load = useCallback(async () => {
    setProgress({ done: 0, total: 50 })
    setError(null)
    try {
      setIndex(await sweepAuctions(setProgress))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the auction house")
    } finally {
      setProgress(null)
    }
  }, [])

  return { index, progress, error, load, restoring }
}

/** Placeholder while a cached index is being read back. */
export function RestoringIndex() {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> Reading cached auction index…
    </p>
  )
}

export function IndexStatus({
  index,
  progress,
  onRefresh,
}: {
  index: AuctionIndex | null
  progress: SweepProgress | null
  onRefresh: () => void
}) {
  if (progress) {
    const pct = Math.round((progress.done / progress.total) * 100)
    return (
      <div className="w-56 space-y-1.5">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Loading auctions</span>
          <span className="tabular">
            {progress.done}/{progress.total}
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-secondary">
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
    )
  }

  if (!index) return null

  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="tabular">
        {index.listings.length.toLocaleString()} auctions · {formatRelativeTime(index.fetchedAt)}
      </span>
      <Button variant="ghost" size="sm" onClick={onRefresh}>
        <RefreshCw /> Refresh
      </Button>
    </div>
  )
}

export function EmptyIndex({ onLoad, reason }: { onLoad: () => void; reason?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Load the auction house</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="max-w-prose text-sm text-muted-foreground">
          {reason ??
            "Hypixel has no server-side search, so finding every listing of an item means downloading all 50 pages of active auctions — roughly 120 MB, once. After that, searches are instant and the index is cached for five minutes."}
        </p>
        <Button onClick={onLoad}>Load auction index</Button>
      </CardContent>
    </Card>
  )
}
