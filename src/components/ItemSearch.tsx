import { useEffect, useMemo, useRef, useState } from "react"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export interface SearchableItem {
  id: string
  name: string
}

interface ItemSearchProps {
  items: SearchableItem[]
  onSelect: (item: SearchableItem) => void
  placeholder?: string
  autoFocus?: boolean
}

/** Ranks exact and prefix matches above incidental substring hits. */
function score(item: SearchableItem, needle: string): number {
  const name = item.name.toLowerCase()
  const id = item.id.toLowerCase()

  if (name === needle || id === needle) return 0
  if (name.startsWith(needle)) return 1
  if (id.startsWith(needle)) return 2

  const wordStart = name.includes(` ${needle}`)
  if (wordStart) return 3
  if (name.includes(needle)) return 4
  if (id.includes(needle)) return 5
  return Number.POSITIVE_INFINITY
}

export function ItemSearch({ items, onSelect, placeholder, autoFocus }: ItemSearchProps) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle.length < 2) return []

    return items
      .map((item) => ({ item, s: score(item, needle) }))
      .filter((r) => Number.isFinite(r.s))
      .sort((a, b) => a.s - b.s || a.item.name.length - b.item.name.length)
      .slice(0, 40)
      .map((r) => r.item)
  }, [items, query])

  useEffect(() => setActive(0), [query])

  // Dismiss the dropdown when focus moves elsewhere on the page.
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [])

  function choose(item: SearchableItem) {
    onSelect(item)
    setQuery("")
    setOpen(false)
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (!open || results.length === 0) return

    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive((i) => (i + 1) % results.length)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((i) => (i - 1 + results.length) % results.length)
    } else if (event.key === "Enter") {
      event.preventDefault()
      choose(results[active])
    } else if (event.key === "Escape") {
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder ?? "Search for an item"}
        autoFocus={autoFocus}
        className="h-10 pl-9"
        aria-autocomplete="list"
        aria-expanded={open && results.length > 0}
      />

      {open && results.length > 0 && (
        <ul
          className="absolute z-50 mt-1 max-h-80 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
          role="listbox"
        >
          {results.map((item, i) => (
            <li key={item.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(item)}
                className={cn(
                  "flex w-full items-baseline justify-between gap-3 rounded px-2 py-1.5 text-left text-sm",
                  i === active ? "bg-accent text-accent-foreground" : "text-foreground",
                )}
              >
                <span className="truncate">{item.name}</span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {item.id}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
