import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { fetchBazaar, fetchItems } from "./hypixel"
import { BazaarPrices } from "./pricing/bazaar"

/** Hypixel refreshes the Bazaar about once a minute. */
const BAZAAR_REFRESH_MS = 60_000

export function useBazaar() {
  return useQuery({
    queryKey: ["bazaar"],
    queryFn: async () => new BazaarPrices(await fetchBazaar()),
    refetchInterval: BAZAAR_REFRESH_MS,
    staleTime: BAZAAR_REFRESH_MS,
  })
}

export function useItems() {
  return useQuery({
    queryKey: ["items"],
    queryFn: fetchItems,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/**
 * Item id -> item, for the O(1) lookups the pricing engine needs.
 *
 * Memoized on `items` itself (stable while the query's data is unchanged) so
 * consumers get a referentially stable Map. Without this, a new Map on every
 * render would retrigger any effect keyed on it every render.
 */
export function useItemMap() {
  const { data: items, ...rest } = useItems()
  const map = useMemo(() => (items ? new Map(items.map((i) => [i.id, i])) : undefined), [items])
  return { ...rest, data: map, items }
}
