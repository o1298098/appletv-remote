import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react"
import { useTheme } from "next-themes"
import { toast } from "sonner"
import {
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Home,
  Languages,
  Link2,
  Loader2,
  Menu,
  Monitor,
  Moon,
  MoreHorizontal,
  Play,
  Scan,
  Sun,
  Tv,
  Unplug,
  Volume1,
  Volume2,
} from "lucide-react"

import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { AtvDevice } from "@/lib/api"
import {
  disconnectDevice,
  healthCheck,
  pairBegin,
  pairCancel,
  pairFinish,
  pairPin,
  scanDevices,
  sendRemote,
} from "@/lib/api"
import { useRemotePressHandlers, type RemotePush } from "@/hooks/use-remote-press-handlers"
import { cn } from "@/lib/utils"
import { Trans, useTranslation } from "react-i18next"
import { LOCALE_STORAGE_KEY, type AppLocale } from "@/i18n/config"

const STORAGE_KEY = "atv-remote-selected-id"

/** 实体遥控感：长按保持压暗；禁止 iOS 长按菜单/半透明层 */
const REMOTE_KEY_BASE =
  "[-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] touch-manipulation select-none active:translate-y-0 active:scale-100"

/** 扫描完成后：优先保留仍在列表中的当前选择，否则上次记录、再否则首台已配对设备 */
function resolveSelectedAfterScan(
  list: AtvDevice[],
  currentSelected: string,
): string {
  if (list.length === 0) return currentSelected
  if (currentSelected && list.some((d) => d.identifier === currentSelected)) {
    return currentSelected
  }
  const stored = localStorage.getItem(STORAGE_KEY) ?? ""
  const matchStored = stored ? list.find((d) => d.identifier === stored) : undefined
  if (matchStored) return matchStored.identifier
  const firstPaired = list.find(
    (d) => d.mrp_credentials || d.companion_credentials,
  )
  if (firstPaired) return firstPaired.identifier
  return list[0].identifier
}

function DeviceActionsMenu({
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

function ThemeToggle() {
  const { t } = useTranslation()
  const { setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const dark = mounted && resolvedTheme === "dark"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        className={cn(
          buttonVariants({ variant: "outline", size: "icon" }),
          "size-9 shrink-0 touch-manipulation",
        )}
        aria-label={t("theme.menu")}
        disabled={!mounted}
      >
        {dark ? (
          <Moon className="size-4 opacity-80" />
        ) : (
          <Sun className="size-4 opacity-80" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem onClick={() => setTheme("system")}>
          <Monitor className="size-4" />
          {t("theme.system")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("light")}>
          <Sun className="size-4" />
          {t("theme.light")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          <Moon className="size-4" />
          {t("theme.dark")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function LanguagePicker() {
  const { i18n, t } = useTranslation()
  const [open, setOpen] = useState(false)
  const activeZh = i18n.language.startsWith("zh")

  const applyLocale = (next: AppLocale) => {
    void i18n.changeLanguage(next)
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
    setOpen(false)
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-9 shrink-0 touch-manipulation"
        aria-label={t("common.language")}
        onClick={() => setOpen(true)}
      >
        <Languages className="size-4 opacity-80" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("language.pickerTitle")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-1">
            <Button
              type="button"
              variant={activeZh ? "secondary" : "outline"}
              className="h-11 w-full touch-manipulation justify-center text-base font-medium"
              onClick={() => applyLocale("zh")}
            >
              {t("language.zh")}
            </Button>
            <Button
              type="button"
              variant={!activeZh ? "secondary" : "outline"}
              className="h-11 w-full touch-manipulation justify-center text-base font-medium"
              onClick={() => applyLocale("en")}
            >
              {t("language.en")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default function App() {
  const { t, i18n } = useTranslation()
  const [devices, setDevices] = useState<AtvDevice[]>([])
  const [selectedId, setSelectedId] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) ?? ""
    } catch {
      return ""
    }
  })
  const [scanning, setScanning] = useState(false)
  /** 仅防并发连点，不用 state，避免整盘 disabled + opacity 像蒙层 */
  const sendingRef = useRef(false)
  const [backendOk, setBackendOk] = useState(true)

  const [pairOpen, setPairOpen] = useState(false)
  const [pairDeviceId, setPairDeviceId] = useState("")
  const [pairSession, setPairSession] = useState<string | null>(null)
  const [pairTvProvides, setPairTvProvides] = useState(false)
  const [pairEnterOnTv, setPairEnterOnTv] = useState<string | null>(null)
  const [pairPinInput, setPairPinInput] = useState("")
  const [pairBusy, setPairBusy] = useState(false)

  const [mobileSheetOpen, setMobileSheetOpen] = useState(false)

  const selected = devices.find((d) => d.identifier === selectedId)
  const selectedIsPaired = Boolean(
    selected?.mrp_credentials || selected?.companion_credentials,
  )

  const credLabelFor = useCallback(
    (d: AtvDevice) =>
      d.mrp_credentials || d.companion_credentials
        ? t("device.paired")
        : t("device.notPaired"),
    [t],
  )

  useEffect(() => {
    document.title = t("app.documentTitle")
  }, [t, i18n.language])

  useEffect(() => {
    if (selectedId) localStorage.setItem(STORAGE_KEY, selectedId)
  }, [selectedId])

  useEffect(() => {
    let cancelled = false
    void healthCheck().then((ok) => {
      if (!cancelled) setBackendOk(ok)
    })
    const t = window.setInterval(() => {
      void healthCheck().then((ok) => {
        if (!cancelled) setBackendOk(ok)
      })
    }, 15000)
    return () => {
      cancelled = true
      window.clearInterval(t)
    }
  }, [])

  const handleScan = useCallback(async (opts?: { silent?: boolean }) => {
    setScanning(true)
    try {
      const list = await scanDevices()
      setDevices(list)
      setSelectedId((prev) => resolveSelectedAfterScan(list, prev))
      if (list.length === 0) {
        if (!opts?.silent) {
          toast.message(t("toast.noDevicesTitle"), {
            description: t("toast.noDevicesDesc"),
          })
        }
        return
      }
      if (!opts?.silent) {
        toast.success(t("toast.devicesFound", { count: list.length }))
      }
    } catch (e) {
      if (!opts?.silent) {
        toast.error(e instanceof Error ? e.message : t("toast.scanFailed"))
      }
    } finally {
      setScanning(false)
    }
  }, [t])

  useEffect(() => {
    void handleScan({ silent: true })
  }, [handleScan])

  const push = useCallback(
    async (command: string, extra?: { action?: string }) => {
      if (!selectedId) {
        toast.error(t("toast.selectAtvFirst"))
        return
      }
      if (sendingRef.current) {
        return
      }
      sendingRef.current = true
      try {
        await sendRemote(selectedId, command, extra)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("toast.sendFailed"))
      } finally {
        sendingRef.current = false
      }
    },
    [selectedId, t],
  )

  const handleDisconnect = useCallback(async () => {
    if (!selectedId) return
    try {
      await disconnectDevice(selectedId)
      toast.success(t("toast.disconnected"))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toast.disconnectFailed"))
    }
  }, [selectedId, t])

  const resetPairUi = () => {
    setPairSession(null)
    setPairTvProvides(false)
    setPairEnterOnTv(null)
    setPairPinInput("")
    setPairBusy(false)
  }

  const openPairDialog = () => {
    resetPairUi()
    setPairDeviceId(selectedId || devices[0]?.identifier || "")
    setPairOpen(true)
  }

  const closePairDialog = () => {
    if (pairSession) void pairCancel(pairSession)
    resetPairUi()
    setPairOpen(false)
  }

  const startPair = async () => {
    if (!pairDeviceId) {
      toast.error(t("pair.chooseDeviceFirst"))
      return
    }
    setPairBusy(true)
    try {
      const r = await pairBegin(pairDeviceId)
      setPairSession(r.session_id)
      setPairTvProvides(r.device_provides_pin)
      setPairEnterOnTv(r.enter_on_tv_pin)
      toast.message(t("toast.pairStarted"), {
        description: t("toast.pairProtocol", { protocol: r.protocol }),
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toast.pairStartFailed"))
    } finally {
      setPairBusy(false)
    }
  }

  const completePairFromTv = async () => {
    if (!pairSession) return
    setPairBusy(true)
    try {
      if (pairTvProvides) {
        await pairPin(pairSession, pairPinInput.trim())
      }
      const ok = await pairFinish(pairSession)
      if (ok) {
        toast.success(t("toast.pairSuccess"))
        await handleScan()
      } else toast.error(t("toast.pairIncomplete"))
      resetPairUi()
      setPairOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toast.pairFailed"))
    } finally {
      setPairBusy(false)
    }
  }

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
    <div className="bg-background flex min-h-dvh flex-col">
      {!backendOk && (
        <div className="bg-destructive/15 text-destructive border-destructive/30 border-b px-3 py-2 text-center text-xs leading-snug md:text-sm">
          <Trans
            i18nKey="backend.unreachable"
            components={{
              folder: (
                <code className="rounded bg-black/5 px-1 dark:bg-white/10" />
              ),
              cmd: (
                <code className="mt-1 block rounded bg-black/5 px-1 text-[11px] break-all dark:bg-white/10 md:mt-0 md:inline md:text-xs" />
              ),
            }}
          />
        </div>
      )}

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

          {/* 桌面端：下拉与工具 */}
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

          {/* 移动端：选设备；已配对时「更多」与选设备同行，省一行 */}
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

      <main className="mx-auto w-full max-w-lg flex-1 px-3 py-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:max-w-3xl md:px-4 md:py-8 md:pb-8">
        <Card className="border-0 shadow-none md:rounded-xl md:border md:border-border/80 md:shadow-sm">
          <CardHeader className="pb-3 pt-0 md:pb-2 md:pt-6 md:px-6">
            <CardTitle className="hidden text-base md:block">
              {t("card.remoteTitle")}
            </CardTitle>
            <CardDescription className="text-muted-foreground line-clamp-2 text-xs md:text-sm">
              {selected ? (
                <>
                  <span className="font-medium text-foreground md:font-normal">
                    {selected.name}
                  </span>
                  <span className="text-muted-foreground"> · {selected.address}</span>
                </>
              ) : (
                t("card.noSelectionHint")
              )}
            </CardDescription>
          </CardHeader>
          <CardContent
            className="space-y-5 pb-6 pt-0 md:space-y-6 md:px-6 md:pb-8"
            onContextMenu={(e) => e.preventDefault()}
          >
            <div>
              <div className="mx-auto grid w-full max-w-[min(100%,20rem)] grid-cols-3 gap-3 md:max-w-[16.25rem] md:gap-2">
                <div />
                <RemoteBtn
                  label={t("card.up")}
                  command="up"
                  disabled={!selectedId}
                  push={push}
                  title={t("card.titleDpad")}
                />
                <div />
                <RemoteBtn
                  label={t("card.left")}
                  command="left"
                  disabled={!selectedId}
                  push={push}
                  title={t("card.titleDpad")}
                />
                <RemoteBtn
                  label={t("card.select")}
                  emphasis
                  command="select"
                  disabled={!selectedId}
                  push={push}
                  title={t("card.titleDpad")}
                />
                <RemoteBtn
                  label={t("card.right")}
                  command="right"
                  disabled={!selectedId}
                  push={push}
                  title={t("card.titleDpad")}
                />
                <div />
                <RemoteBtn
                  label={t("card.down")}
                  command="down"
                  disabled={!selectedId}
                  push={push}
                  title={t("card.titleDpad")}
                />
                <div />
              </div>
            </div>

            <Separator className="max-md:opacity-60" />

            <div className="grid grid-cols-3 gap-2 md:flex md:flex-wrap md:justify-center md:gap-2">
              <HoldableActionButton
                command="menu"
                push={push}
                disabled={!selectedId}
                variant="outline"
                title={t("card.titleMenu")}
                className="flex h-14 touch-manipulation flex-col gap-1 py-2 text-xs font-medium md:h-auto md:min-h-12 md:min-w-[4.5rem] md:flex-row md:gap-1.5 md:text-sm"
              >
                <Menu className="size-5 md:size-5" />
                {t("card.menu")}
              </HoldableActionButton>
              <Button
                type="button"
                disabled={!selectedId}
                onClick={() => void push("play_pause")}
                title={t("card.titlePlayPause")}
                className={cn(
                  REMOTE_KEY_BASE,
                  "active:bg-primary active:text-primary-foreground",
                  "flex h-14 flex-col gap-1 py-2 text-xs font-medium md:h-auto md:min-h-12 md:min-w-[4.5rem] md:flex-row md:gap-1.5 md:text-sm",
                )}
              >
                <Play className="size-5" />
                {t("card.play")}
              </Button>
              <HoldableActionButton
                command="home"
                push={push}
                disabled={!selectedId}
                variant="outline"
                title={t("card.titleHome")}
                className="flex h-14 touch-manipulation flex-col gap-1 py-2 text-xs font-medium md:h-auto md:min-h-12 md:min-w-[4.5rem] md:flex-row md:gap-1.5 md:text-sm"
              >
                <Home className="size-5" />
                {t("card.home")}
              </HoldableActionButton>
            </div>

            <div className="flex max-w-md items-center justify-between gap-2 md:mx-auto md:max-w-none md:justify-center md:gap-2">
              <Button
                variant="secondary"
                type="button"
                disabled={!selectedId}
                onClick={() => void push("volume_down")}
                aria-label={t("card.ariaVolumeDown")}
                className={cn(
                  REMOTE_KEY_BASE,
                  "active:bg-secondary active:text-secondary-foreground",
                  "size-12 shrink-0 rounded-xl md:size-9 md:rounded-lg",
                )}
              >
                <Volume1 className="size-6 md:size-5" />
              </Button>
              <Button
                variant="secondary"
                type="button"
                disabled={!selectedId}
                onClick={() => void push("volume_up")}
                aria-label={t("card.ariaVolumeUp")}
                className={cn(
                  REMOTE_KEY_BASE,
                  "active:bg-secondary active:text-secondary-foreground",
                  "size-12 shrink-0 rounded-xl md:size-9 md:rounded-lg",
                )}
              >
                <Volume2 className="size-6 md:size-5" />
              </Button>
              <Button
                variant="ghost"
                type="button"
                disabled={!selectedId}
                onClick={() => void push("skip_backward")}
                aria-label={t("card.ariaSkipBack")}
                className={cn(
                  REMOTE_KEY_BASE,
                  "active:bg-muted/60 active:text-foreground",
                  "size-12 shrink-0 rounded-xl md:size-9 md:rounded-lg",
                )}
              >
                <ChevronsLeft className="size-6 md:size-5" />
              </Button>
              <Button
                variant="ghost"
                type="button"
                disabled={!selectedId}
                onClick={() => void push("skip_forward")}
                aria-label={t("card.ariaSkipForward")}
                className={cn(
                  REMOTE_KEY_BASE,
                  "active:bg-muted/60 active:text-foreground",
                  "size-12 shrink-0 rounded-xl md:size-9 md:rounded-lg",
                )}
              >
                <ChevronsRight className="size-6 md:size-5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>

      <Dialog open={pairOpen} onOpenChange={(o) => !o && closePairDialog()}>
        <DialogContent className="max-h-[min(90dvh,36rem)] max-w-md overflow-y-auto pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <DialogHeader>
            <DialogTitle>{t("pair.dialogTitle")}</DialogTitle>
            <DialogDescription>
              <Trans
                i18nKey="pair.description"
                components={{ strong: <strong /> }}
              />
            </DialogDescription>
          </DialogHeader>

          {!pairSession ? (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>{t("pair.deviceLabel")}</Label>
                <Select
                  value={pairDeviceId || undefined}
                  onValueChange={(v) => setPairDeviceId(v ?? "")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("device.selectInDialog")} />
                  </SelectTrigger>
                  <SelectContent>
                    {devices.map((d) => (
                      <SelectItem key={d.identifier} value={d.identifier}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="ghost" type="button" onClick={closePairDialog}>
                  {t("actions.cancel")}
                </Button>
                <Button
                  type="button"
                  disabled={pairBusy || devices.length === 0}
                  onClick={() => void startPair()}
                >
                  {pairBusy && <Loader2 className="size-4 animate-spin" />}
                  {t("pair.start")}
                </Button>
              </DialogFooter>
            </div>
          ) : pairTvProvides ? (
            <div className="space-y-4 py-2">
              <p className="text-sm">{t("pair.pinHint")}</p>
              <Input
                inputMode="numeric"
                placeholder={t("pair.pinPlaceholder")}
                value={pairPinInput}
                onChange={(e) => setPairPinInput(e.target.value)}
              />
              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="ghost" type="button" onClick={closePairDialog}>
                  {t("actions.cancel")}
                </Button>
                <Button
                  type="button"
                  disabled={pairBusy || !pairPinInput.trim()}
                  onClick={() => void completePairFromTv()}
                >
                  {t("pair.submitFinish")}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              {pairEnterOnTv && (
                <div className="bg-muted rounded-lg border p-4 text-center">
                  <p className="text-muted-foreground text-xs">
                    {t("pair.enterOnTv")}
                  </p>
                  <p className="text-foreground mt-1 text-3xl font-semibold tracking-widest">
                    {pairEnterOnTv}
                  </p>
                </div>
              )}
              <p className="text-muted-foreground text-xs">
                {t("pair.finishHint")}
              </p>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="ghost" type="button" onClick={closePairDialog}>
                  {t("actions.cancel")}
                </Button>
                <Button
                  type="button"
                  disabled={pairBusy}
                  onClick={() => void completePairFromTv()}
                >
                  {t("pair.finish")}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function RemoteBtn({
  label,
  command,
  push,
  disabled,
  emphasis,
  title,
}: {
  label: string
  command: string
  push: RemotePush
  disabled?: boolean
  emphasis?: boolean
  title: string
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
      className={cn(
        REMOTE_KEY_BASE,
        "h-14 w-full md:h-16",
        emphasis
          ? "shadow-sm active:bg-primary active:text-primary-foreground md:shadow-sm"
          : "active:bg-muted/55 active:text-foreground",
      )}
      {...press}
    >
      <span className="text-base font-semibold md:text-sm md:font-medium">
        {label}
      </span>
    </Button>
  )
}

function HoldableActionButton({
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
