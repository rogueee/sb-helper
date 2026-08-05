import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Space/Enter activation for elements standing in as buttons — a `<tr>` in
 * particular, which needs `role="button" tabIndex={0}` to be reachable at
 * all, but still ships with no key handling of its own.
 */
export function onActivateKey(handler: () => void) {
  return (event: React.KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    handler()
  }
}
