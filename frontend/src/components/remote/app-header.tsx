import {
  ChevronDown,
  Loader2,
  Monitor,
  MoreHorizontal,
  Scan,
  Tv,
  Unplug,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button, buttonVariants } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import type { AtvDevice } from "@/lib/api"
import { cn } from "@/lib/utils"
import { DeviceActionsMenu } from "@/components/remote/device-actions-menu"
import { LanguagePicker } from "@/components/remote/language-picker"
import { ThemeToggle } from "@/components/remote/theme-toggle"

export function AppHeader({
  devices,
  selectedId,
  setSelectedId,
  scanning,
  selected,
  selectedIsPaired,
  credLabelFor,
  handleScan,
  openPairDialog,
  handleDisconnect,
  mobileSheetOpen,
  setMobileSheetOpen,
}: {
  devices: AtvDevice[]
  selectedId: string
  setSelectedId: (id: string) => void
  scanning: boolean
  selected: AtvDevice | undefined
  selectedIsPaired: boolean
  credLabelFor: (d: AtvDevice) => string
  handleScan: (opts?: { silent?: boolean }) => void | Promise<void>
  openPairDialog: () => void
  handleDisconnect: () => void | Promise<void>
  mobileSheetOpen: boolean
  setMobileSheetOpen: (open: boolean) => void
}) {
  const { t } = useTranslation()

  const DeviceListButton = ({ onPick }: { onPick?: () => void }) => (
    <div className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto pr-1">
      {devices.length === 0 ? (
        <p className="text-muted-foreground py-6 text-center text-sm">
          {t("device.emptyList")}
        </p>
      ) : (
        devices.map((d) => (
          <Button
            key={d.identifier}
            variant={selectedId === d.identifier ? "secondary" : "ghost"}
            className="h-auto min-h-[3rem] w-full touch-manipulation justify-start gap-2 py-3.5 text-left text-base"
            onClick={() => {
              setSelectedId(d.identifier)
              onPick?.()
            }}
          >
            <Tv className="size-4 shrink-0 opacity-70" />
            <span className="min-w-0 flex-1 truncate">{d.name}</span>
            <Badge variant="outline" className="shrink-0 text-[10px]">
              {credLabelFor(d)}
            </Badge>
          </Button>
        ))
      )}
    </div>
  )

  return (
    <header className="bg-background/90 supports-[backdrop-filter]:bg-background/75 sticky top-0 z-30 border-b backdrop-blur-md pt-safe">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-2 px-3 pb-3 md:max-w-3xl md:flex-row md:items-start md:justify-between md:gap-4 md:px-4 md:pb-4 md:pt-2">
        <div className="min-w-0 flex-1 pt-1 md:pt-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h1 className="text-foreground flex items-center gap-2 text-base font-semibold tracking-tight md:text-xl">
                <Monitor className="size-[1.125rem] shrink-0 opacity-80 md:size-5" />
                {t("app.title")}
              </h1>
              <p className="text-muted-foreground mt-0.5 hidden text-xs md:block md:text-sm">
                {t("app.subtitle")}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <ThemeToggle />
              <LanguagePicker />
            </div>
          </div>
        </div>

        <div className="hidden min-w-0 flex-col gap-2 md:flex md:min-w-[280px] md:max-w-sm">
          <Label className="text-muted-foreground mb-0 block text-xs">
            {t("device.current")}
          </Label>
          <Select
            value={selectedId || undefined}
            onValueChange={(v) => setSelectedId(v ?? "")}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("device.selectAtv")} />
            </SelectTrigger>
            <SelectContent>
              {devices.map((d) => (
                <SelectItem key={d.identifier} value={d.identifier}>
                  {d.name} ({credLabelFor(d)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedIsPaired ? (
            <DeviceActionsMenu
              align="start"
              scanning={scanning}
              selectedId={selectedId}
              onScan={() => void handleScan()}
              onPair={openPairDialog}
              onDisconnect={handleDisconnect}
              triggerClassName="w-full touch-manipulation gap-2"
              triggerChildren={
                <>
                  <MoreHorizontal className="size-4 opacity-80" />
                  {t("actions.more")}
                </>
              }
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                type="button"
                disabled={scanning}
                onClick={() => void handleScan()}
                className="flex-1"
              >
                {scanning ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Scan className="size-4" />
                )}
                {t("actions.scan")}
              </Button>
              <Button
                variant="outline"
                type="button"
                onClick={openPairDialog}
                className="flex-1"
              >
                {t("actions.pair")}
              </Button>
              <Button
                variant="ghost"
                type="button"
                disabled={!selectedId}
                onClick={() => void handleDisconnect()}
                className="flex-1"
              >
                <Unplug className="size-4" />
                {t("actions.disconnect")}
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 md:hidden">
          <div className="flex gap-2">
            <Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>
              <SheetTrigger
                type="button"
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "h-12 min-w-0 flex-1 touch-manipulation justify-between gap-2 px-3 text-left text-base",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Tv className="size-5 shrink-0 opacity-80" />
                  <span className="truncate font-medium">
                    {selected?.name ?? t("device.pickAtv")}
                  </span>
                </span>
                <ChevronDown className="size-5 shrink-0 opacity-50" />
              </SheetTrigger>
              <SheetContent
                side="bottom"
                className="flex max-h-[min(85dvh,32rem)] flex-col gap-0 rounded-t-2xl pb-safe"
              >
                <SheetHeader className="border-b pb-3 text-left">
                  <SheetTitle className="text-lg">
                    {t("device.chooseSheetTitle")}
                  </SheetTitle>
                </SheetHeader>
                <div className="min-h-0 flex-1 overflow-y-auto py-2">
                  <DeviceListButton onPick={() => setMobileSheetOpen(false)} />
                </div>
              </SheetContent>
            </Sheet>
            {selectedIsPaired ? (
              <DeviceActionsMenu
                align="end"
                scanning={scanning}
                selectedId={selectedId}
                onScan={() => void handleScan()}
                onPair={openPairDialog}
                onDisconnect={handleDisconnect}
                triggerClassName="size-12 shrink-0 touch-manipulation p-0"
                triggerProps={{
                  "aria-label": t("actions.moreAria"),
                }}
                triggerChildren={
                  <MoreHorizontal className="size-5 opacity-80" />
                }
              />
            ) : null}
          </div>

          {!selectedIsPaired ? (
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant="secondary"
                type="button"
                disabled={scanning}
                onClick={() => void handleScan()}
                className="h-11 touch-manipulation text-sm font-medium"
              >
                {scanning ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Scan className="size-4" />
                )}
                {t("actions.scan")}
              </Button>
              <Button
                variant="outline"
                type="button"
                onClick={openPairDialog}
                className="h-11 touch-manipulation text-sm font-medium"
              >
                {t("actions.pair")}
              </Button>
              <Button
                variant="ghost"
                type="button"
                disabled={!selectedId}
                onClick={() => void handleDisconnect()}
                className="h-11 touch-manipulation text-sm font-medium"
              >
                <Unplug className="size-4" />
                {t("actions.disconnect")}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
