/**
 * Coin formatting.
 *
 * SkyBlock prices span from fractions of a coin to billions, so a single format
 * cannot serve both. Compact notation keeps tables scannable; the exact value is
 * always available on hover.
 */

export function formatCoins(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—"

  const sign = value < 0 ? "-" : ""
  const n = Math.abs(value)

  if (n >= 1_000_000_000) return `${sign}${trim(n / 1_000_000_000)}b`
  if (n >= 1_000_000) return `${sign}${trim(n / 1_000_000)}m`
  if (n >= 1_000) return `${sign}${trim(n / 1_000)}k`
  if (n >= 1) return `${sign}${Math.round(n).toLocaleString()}`
  return `${sign}${n.toFixed(2)}`
}

function trim(n: number): string {
  // Two significant decimals below 10, one below 100, none above.
  const decimals = n < 10 ? 2 : n < 100 ? 1 : 0
  // With no decimal places there is nothing to trim — stripping trailing
  // zeros here would mangle whole numbers like 480 or 500 into 48 or 5.
  if (decimals === 0) return String(Math.round(n))
  // Trailing zeros after the point only: the point stops the match from
  // reaching into the integer part (e.g. "40.0" -> "40.", never "4").
  return n.toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "")
}

export function formatExact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—"
  return Math.round(value).toLocaleString()
}

export function formatSigned(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—"
  return `${value > 0 ? "+" : ""}${formatCoins(value)}`
}

export function formatRelativeTime(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000)
  if (seconds < 10) return "just now"
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.round(minutes / 60)}h ago`
}

export function formatQuantity(n: number): string {
  return n.toLocaleString()
}
