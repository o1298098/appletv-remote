import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { useRemotePressHandlers, type RemotePush } from "@/hooks/use-remote-press-handlers"
import { REMOTE_KEY_BASE } from "@/lib/atv-remote-constants"
import { cn } from "@/lib/utils"

export function RemoteBtn({
  label,
  command,
  push,
  disabled,
  emphasis,
  title,
  icon,
}: {
  label: string
  command: string
  push: RemotePush
  disabled?: boolean
  emphasis?: boolean
  title: string
  icon?: ReactNode
}) {
  const press = useRemotePressHandlers(
    push,
    command,
    Boolean(disabled),
    true,
  )
  return (
    <Button
      type="button"
      variant={emphasis ? "default" : "outline"}
      size="icon-lg"
      disabled={disabled}
      title={title}
      aria-label={icon ? label : undefined}
      className={cn(
        REMOTE_KEY_BASE,
        "h-14 w-full md:h-16",
        emphasis
          ? "shadow-sm active:bg-primary active:text-primary-foreground md:shadow-sm"
          : "active:bg-muted/55 active:text-foreground",
      )}
      {...press}
    >
      {icon ?? (
        <span className="text-base font-semibold md:text-sm md:font-medium">
          {label}
        </span>
      )}
    </Button>
  )
}

export function HoldableActionButton({
  command,
  push,
  disabled,
  variant,
  className,
  title,
  children,
}: {
  command: string
  push: RemotePush
  disabled: boolean
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link"
  className?: string
  title?: string
  children: ReactNode
}) {
  const press = useRemotePressHandlers(push, command, disabled, true)
  const activeByVariant =
    variant === "outline"
      ? "active:bg-muted/55 active:text-foreground"
      : "active:bg-primary active:text-primary-foreground"

  return (
    <Button
      type="button"
      variant={variant}
      disabled={disabled}
      className={cn(REMOTE_KEY_BASE, activeByVariant, className)}
      title={title}
      {...press}
    >
      {children}
    </Button>
  )
}
