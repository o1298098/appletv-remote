import type { ComponentProps, ReactNode } from "react"
import { Link2, Loader2, Scan, Unplug } from "lucide-react"
import { useTranslation } from "react-i18next"
import { buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export function DeviceActionsMenu({
  align,
  triggerClassName,
  triggerChildren,
  triggerProps,
  scanning,
  selectedId,
  onScan,
  onPair,
  onDisconnect,
}: {
  align: "start" | "end"
  triggerClassName?: string
  triggerChildren: ReactNode
  triggerProps?: ComponentProps<typeof DropdownMenuTrigger>
  scanning: boolean
  selectedId: string
  onScan: () => void
  onPair: () => void
  onDisconnect: () => void
}) {
  const { t } = useTranslation()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        className={cn(
          buttonVariants({ variant: "outline" }),
          triggerClassName,
        )}
        {...triggerProps}
      >
        {triggerChildren}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-44">
        <DropdownMenuItem disabled={scanning} onClick={() => void onScan()}>
          {scanning ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Scan className="size-4" />
          )}
          {t("actions.scan")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onPair}>
          <Link2 className="size-4" />
          {t("actions.pair")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={!selectedId}
          onClick={() => void onDisconnect()}
        >
          <Unplug className="size-4" />
          {t("actions.disconnect")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
