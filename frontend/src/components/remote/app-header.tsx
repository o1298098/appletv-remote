import {
  ChevronDown,
  Loader2,
  Monitor,
  MoreHorizontal,
  Scan,
  Tv,
  Unplug,
  X,
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
  SheetClose,
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

function deviceIsPaired(d: AtvDevice) {
  return Boolean(d.mrp_credentials || d.companion_credentials)
}

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
  openPairDialogAndStartPairing,
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
  openPairDialogAndStartPairing: (deviceId: string) => void | Promise<void>
  handleDisconnect: () => void | Promise<void>
  mobileSheetOpen: boolean
  setMobileSheetOpen: (open: boolean) => void
}) {
  const { t } = useTranslation()

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
              <SelectValue placeholder={t("device.selectAtv")}>
                {selected ? (
                  <>
                    {selected.name}
                    <span className="text-muted-foreground">
                      {" "}
                      ({credLabelFor(selected)})
                    </span>
                  </>
                ) : selectedId ? (
                  <span className="text-muted-foreground">…</span>
                ) : undefined}
              </SelectValue>
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
          <Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>
            <SheetTrigger
              type="button"
              className={cn(
                buttonVariants({ variant: "outline" }),
                "h-12 w-full min-w-0 touch-manipulation justify-between gap-2 px-3 text-left text-base",
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
              showCloseButton={false}
              className="flex max-h-[min(88dvh,36rem)] flex-col gap-0 rounded-t-2xl p-0 pb-safe"
            >
              <SheetHeader className="border-b flex flex-row items-center gap-2 py-3 pr-2 pl-4">
                <SheetTitle className="text-lg min-w-0 flex-1 text-left">
                  {t("device.chooseSheetTitle")}
                </SheetTitle>
                <div className="flex shrink-0 items-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={scanning}
                    className="size-10 touch-manipulation"
                    title={t("actions.scan")}
                    aria-label={t("actions.scan")}
                    onClick={() => void handleScan()}
                  >
                    {scanning ? (
                      <Loader2 className="size-5 animate-spin" />
                    ) : (
                      <Scan className="size-5 opacity-80" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={!selectedId}
                    className="text-destructive hover:text-destructive size-10 touch-manipulation"
                    title={t("actions.disconnect")}
                    aria-label={t("actions.disconnect")}
                    onClick={() => {
                      setMobileSheetOpen(false)
                      void handleDisconnect()
                    }}
                  >
                    <Unplug className="size-5" />
                  </Button>
                  <SheetClose
                    type="button"
                    className={cn(
                      buttonVariants({ variant: "ghost", size: "icon" }),
                      "size-10 touch-manipulation",
                    )}
                    title={t("actions.close")}
                    aria-label={t("actions.close")}
                  >
                    <X className="size-5 opacity-80" />
                  </SheetClose>
                </div>
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                {devices.length === 0 ? (
                  <p className="text-muted-foreground py-6 text-center text-sm">
                    {t("device.emptyList")}
                  </p>
                ) : (
                  <div className="flex flex-col gap-1 pr-1">
                    {devices.map((d) => {
                      const paired = deviceIsPaired(d)
                      return (
                        <Button
                          key={d.identifier}
                          variant={
                            selectedId === d.identifier ? "secondary" : "ghost"
                          }
                          className="h-auto min-h-[3rem] w-full touch-manipulation justify-start gap-2 py-3.5 text-left text-base"
                          onClick={() => {
                            setSelectedId(d.identifier)
                            setMobileSheetOpen(false)
                            if (!paired) {
                              window.setTimeout(() => {
                                void openPairDialogAndStartPairing(d.identifier)
                              }, 200)
                            }
                          }}
                        >
                          <Tv className="size-4 shrink-0 opacity-70" />
                          <span className="min-w-0 flex-1 truncate">
                            {d.name}
                          </span>
                          <Badge
                            variant="outline"
                            className="shrink-0 text-[10px]"
                          >
                            {credLabelFor(d)}
                          </Badge>
                        </Button>
                      )
                    })}
                  </div>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}
