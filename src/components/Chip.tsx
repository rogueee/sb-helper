import { cn } from "@/lib/utils"

/** Small toggleable pill used by every filter and sort control in the app. */
export function Chip({
  active,
  onClick,
  className,
  title,
  children,
}: {
  active: boolean
  onClick: (e: React.MouseEvent) => void
  className?: string
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={cn(
        "rounded-md border px-2 py-0.5 text-xs transition-colors",
        active
          ? "border-foreground/40 bg-accent font-medium"
          : "border-transparent bg-secondary/60 text-muted-foreground hover:bg-secondary",
        className,
      )}
    >
      {children}
    </button>
  )
}
