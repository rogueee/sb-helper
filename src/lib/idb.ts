/**
 * Tiny promise wrapper over a single IndexedDB object store.
 *
 * The items resource is ~5 MB and the auction sweep is ~120 MB; localStorage
 * cannot hold either, so cached payloads live here and survive reloads.
 */

const DB_NAME = "sb-helper"
const DB_VERSION = 1
const STORE = "cache"

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

interface Entry<T> {
  value: T
  storedAt: number
}

export async function idbGet<T>(key: string, maxAgeMs: number): Promise<T | null> {
  try {
    const db = await open()
    const entry = await new Promise<Entry<T> | undefined>((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    if (!entry) return null
    if (Date.now() - entry.storedAt > maxAgeMs) return null
    return entry.value
  } catch {
    // Private browsing and storage-pressure eviction both surface here.
    // A cache miss is always recoverable, so degrade to a network fetch.
    return null
  }
}

export async function idbSet<T>(key: string, value: T): Promise<void> {
  try {
    const db = await open()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite")
      tx.objectStore(STORE).put({ value, storedAt: Date.now() } satisfies Entry<T>, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      // A quota overrun aborts the transaction without firing onerror.
      tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"))
    })
  } catch (err) {
    // Writing the cache is best-effort and must not break a request — but it
    // must not be invisible either. A silently failing write looks exactly like
    // a working cache until you notice every reload re-paying a 60 s sweep.
    console.warn(`Cache write failed for "${key}":`, err)
  }
}

export async function idbDelete(key: string): Promise<void> {
  try {
    const db = await open()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite")
      tx.objectStore(STORE).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // ignore
  }
}
