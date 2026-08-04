import { useCallback, useEffect, useState } from "react"

/**
 * State backed by localStorage, kept in sync across tabs.
 * Used for pinned items, which should survive reloads without any account.
 */
export function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw === null ? initial : (JSON.parse(raw) as T)
    } catch {
      return initial
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // Quota or private-mode failures are not worth surfacing to the user.
    }
  }, [key, value])

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== key || event.newValue === null) return
      try {
        setValue(JSON.parse(event.newValue) as T)
      } catch {
        // Ignore a malformed write from another tab.
      }
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [key])

  return [value, setValue] as const
}

/** Pinned item ids, ordered by when they were pinned. */
export function usePins(storageKey: string) {
  const [pins, setPins] = useLocalStorage<string[]>(storageKey, [])

  const toggle = useCallback(
    (id: string) => {
      setPins((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
    },
    [setPins],
  )

  const isPinned = useCallback((id: string) => pins.includes(id), [pins])

  return { pins, toggle, isPinned }
}
