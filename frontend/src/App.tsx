import type { TFunction } from "i18next"
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  Hand,
  Home,
  Move,
  Play,
  Power,
  Undo2,
  Volume1,
  Volume2,
} from "lucide-react"
import { Trans } from "react-i18next"
import { AppHeader } from "@/components/remote/app-header"
import { InstalledAppsDialogTrigger } from "@/components/remote/installed-apps-dialog"
import { KeyboardAutoDialog } from "@/components/remote/keyboard-auto-dialog"
import { PairDialog } from "@/components/remote/pair-dialog"
import { PlayingSection } from "@/components/remote/playing-section"
import {
  HoldableActionButton,
  RemoteBtn,
} from "@/components/remote/remote-buttons"
import { RemoteTouchPad } from "@/components/remote/remote-touch-pad"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { useAtvRemoteApp } from "@/hooks/use-atv-remote-app"
import { useMobileNavMode } from "@/hooks/use-mobile-nav-mode"
import type { RemotePush } from "@/hooks/use-remote-press-handlers"
import { REMOTE_KEY_BASE } from "@/lib/atv-remote-constants"
import { cn } from "@/lib/utils"

function DpadGrid({
  selectedId,
  push,
  t,
}: {
  selectedId: string | null
  push: RemotePush
  t: TFunction
}) {
  return (
    <div className="mx-auto grid w-full max-w-[13.5rem] grid-cols-3 gap-1.5 md:max-w-[14rem] md:gap-2">
      <div />
      <RemoteBtn
        label={t("card.up")}
        command="up"
        disabled={!selectedId}
        push={push}
        title={t("card.titleDpad")}
        icon={
          <ChevronUp className="size-6 opacity-90" strokeWidth={2.25} />
        }
      />
      <div />
      <RemoteBtn
        label={t("card.left")}
        command="left"
        disabled={!selectedId}
        push={push}
        title={t("card.titleDpad")}
        icon={
          <ChevronLeft className="size-6 opacity-90" strokeWidth={2.25} />
        }
      />
      <div className="flex items-center justify-center">
        <RemoteBtn
          label={t("card.select")}
          emphasis
          command="select"
          disabled={!selectedId}
          push={push}
          title={t("card.titleDpad")}
        />
      </div>
      <RemoteBtn
        label={t("card.right")}
        command="right"
        disabled={!selectedId}
        push={push}
        title={t("card.titleDpad")}
        icon={
          <ChevronRight className="size-6 opacity-90" strokeWidth={2.25} />
        }
      />
      <div />
      <RemoteBtn
        label={t("card.down")}
        command="down"
        disabled={!selectedId}
        push={push}
        title={t("card.titleDpad")}
        icon={
          <ChevronDown className="size-6 opacity-90" strokeWidth={2.25} />
        }
      />
      <div />
    </div>
  )
}

const MOBILE_MODE_TOGGLE_CLASS =
  "absolute top-2 right-2 z-20 size-9 touch-manipulation rounded-lg border border-border/60 bg-background/85 shadow-sm backdrop-blur-sm"

export default function App() {
  const {
    t,
    devices,
    selectedId,
    setSelectedId,
    scanning,
    backendOk,
    pairOpen,
    pairDeviceId,
    setPairDeviceId,
    pairSession,
    pairTvProvides,
    pairEnterOnTv,
    pairPinInput,
    setPairPinInput,
    pairBusy,
    mobileSheetOpen,
    setMobileSheetOpen,
    playingSnap,
    playingInitial,
    selected,
    selectedIsPaired,
    credLabelFor,
    handleScan,
    push,
    handleDisconnect,
    openPairDialog,
    openPairDialogAndStartPairing,
    closePairDialog,
    startPair,
    completePairFromTv,
  } = useAtvRemoteApp()
  const { mobileNavMode, setMobileNavMode } = useMobileNavMode()

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

      <AppHeader
        devices={devices}
        selectedId={selectedId}
        setSelectedId={setSelectedId}
        scanning={scanning}
        selected={selected}
        selectedIsPaired={selectedIsPaired}
        credLabelFor={credLabelFor}
        handleScan={handleScan}
        openPairDialog={openPairDialog}
        openPairDialogAndStartPairing={openPairDialogAndStartPairing}
        handleDisconnect={handleDisconnect}
        mobileSheetOpen={mobileSheetOpen}
        setMobileSheetOpen={setMobileSheetOpen}
      />

      <main className="mx-auto w-full max-w-lg flex-1 px-3 py-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:max-w-3xl md:px-4 md:py-8 md:pb-8">
        <Card className="overflow-visible border-0 shadow-none md:rounded-xl md:border md:border-border/80 md:shadow-sm">
          <CardHeader className="space-y-0 pb-2 pt-0 md:space-y-1.5 md:pb-1.5 md:pt-6 md:px-6">
            <CardTitle className="hidden text-base md:block">
              {t("card.remoteTitle")}
            </CardTitle>
            <div className="flex items-start justify-between gap-2">
              <CardDescription className="text-muted-foreground min-w-0 flex-1 pt-0.5 line-clamp-2 text-xs md:pt-0 md:text-sm">
                {selected ? (
                  <>
                    <span className="font-medium text-foreground md:font-normal">
                      {selected.name}
                    </span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {selected.address}
                    </span>
                  </>
                ) : (
                  t("card.noSelectionHint")
                )}
              </CardDescription>
              {selectedId ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  {selectedIsPaired ? (
                    <InstalledAppsDialogTrigger deviceId={selectedId} />
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-9 shrink-0 touch-manipulation"
                    onClick={() => void push("power_toggle")}
                    title={t("actions.tvPower")}
                    aria-label={t("actions.tvPowerAria")}
                  >
                    <Power className="size-4 opacity-80" />
                  </Button>
                </div>
              ) : null}
            </div>
          </CardHeader>
          <CardContent
            className="space-y-3 pb-4 pt-0 md:space-y-4 md:px-6 md:pb-6"
            onContextMenu={(e) => e.preventDefault()}
          >
            {selectedId && selectedIsPaired ? (
              <div className="h-[7.5rem] shrink-0 overflow-hidden rounded-lg border border-border/40 bg-muted/40 px-3.5 py-2.5 dark:bg-muted/25">
                <div className="flex h-full min-h-0 flex-col overflow-hidden">
                  <PlayingSection
                    deviceId={selectedId}
                    snapshot={playingSnap}
                    initialLoading={playingInitial}
                    onSeek={(sec) =>
                      void push("set_position", { position_sec: sec })
                    }
                  />
                </div>
              </div>
            ) : null}

            <div className="mx-auto w-full max-w-none md:max-w-sm">
              <div className="md:hidden">
                {mobileNavMode === "touchpad" ? (
                  <div className="relative">
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      className={MOBILE_MODE_TOGGLE_CLASS}
                      onClick={() => setMobileNavMode("dpad")}
                      title={t("card.switchToButtons")}
                      aria-label={t("card.switchToButtonsAria")}
                    >
                      <Move className="size-4 opacity-90" />
                    </Button>
                    <RemoteTouchPad
                      deviceId={selectedId ?? ""}
                      disabled={!selectedId}
                      showHint={false}
                      showClickButtons={false}
                      padClassName="max-w-none min-h-[13rem] w-full rounded-2xl border-border/70 bg-muted/25 ring-1 ring-border/50 aspect-[16/10]"
                    />
                  </div>
                ) : (
                  <div className="relative">
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      className={MOBILE_MODE_TOGGLE_CLASS}
                      onClick={() => setMobileNavMode("touchpad")}
                      title={t("card.switchToTouchpad")}
                      aria-label={t("card.switchToTouchpadAria")}
                    >
                      <Hand className="size-4 opacity-90" strokeWidth={2} />
                    </Button>
                    <div className="rounded-2xl bg-muted/25 p-3 ring-1 ring-border/50">
                      <DpadGrid
                        selectedId={selectedId}
                        push={push}
                        t={t}
                      />
                    </div>
                  </div>
                )}
              </div>
              <div className="hidden rounded-2xl bg-muted/25 p-3 ring-1 ring-border/50 md:block md:p-3">
                <DpadGrid selectedId={selectedId} push={push} t={t} />
              </div>
            </div>

            <Separator className="bg-border/60" />

            <div className="grid grid-cols-3 gap-2 md:mx-auto md:max-w-md md:gap-2.5">
              <HoldableActionButton
                command="menu"
                push={push}
                disabled={!selectedId}
                variant="outline"
                title={t("card.titleBack")}
                className="flex h-14 touch-manipulation flex-col gap-1 rounded-xl border-border/70 py-2.5 text-xs font-medium md:h-12 md:flex-row md:gap-2 md:text-sm"
              >
                <Undo2 className="size-[1.15rem] opacity-80" />
                {t("card.back")}
              </HoldableActionButton>
              <Button
                type="button"
                variant="outline"
                disabled={!selectedId}
                onClick={() => void push("play_pause")}
                title={t("card.titlePlayPause")}
                className={cn(
                  REMOTE_KEY_BASE,
                  "border-primary/35 bg-primary/[0.07] text-primary hover:bg-primary/12 dark:bg-primary/15 dark:hover:bg-primary/20",
                  "flex h-14 flex-col gap-1 rounded-xl py-2.5 text-xs font-medium md:h-12 md:flex-row md:gap-2 md:text-sm",
                )}
              >
                <Play className="size-[1.15rem] opacity-90" />
                {t("card.play")}
              </Button>
              <HoldableActionButton
                command="home"
                push={push}
                disabled={!selectedId}
                variant="outline"
                title={t("card.titleHome")}
                className="flex h-14 touch-manipulation flex-col gap-1 rounded-xl border-border/70 py-2.5 text-xs font-medium md:h-12 md:flex-row md:gap-2 md:text-sm"
              >
                <Home className="size-[1.15rem] opacity-80" />
                {t("card.home")}
              </HoldableActionButton>
            </div>

            <Separator className="bg-border/60" />

            <div className="mx-auto flex w-full max-w-md flex-wrap items-center justify-center gap-2 md:max-w-xl md:gap-3">
              <Button
                variant="secondary"
                type="button"
                disabled={!selectedId}
                onClick={() => void push("volume_down")}
                aria-label={t("card.ariaVolumeDown")}
                className={cn(
                  REMOTE_KEY_BASE,
                  "active:bg-secondary active:text-secondary-foreground",
                  "size-10 shrink-0 touch-manipulation rounded-lg md:size-9",
                )}
              >
                <Volume1 className="size-5" />
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
                  "size-10 shrink-0 touch-manipulation rounded-lg md:size-9",
                )}
              >
                <Volume2 className="size-5" />
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
                  "size-10 shrink-0 touch-manipulation rounded-lg md:size-9",
                )}
              >
                <ChevronsLeft className="size-5" />
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
                  "size-10 shrink-0 touch-manipulation rounded-lg md:size-9",
                )}
              >
                <ChevronsRight className="size-5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>

      {selectedId && selectedIsPaired ? (
        <KeyboardAutoDialog deviceId={selectedId} enabled />
      ) : null}

      <PairDialog
        open={pairOpen}
        onClose={closePairDialog}
        devices={devices}
        pairDeviceId={pairDeviceId}
        onPairDeviceIdChange={setPairDeviceId}
        pairSession={pairSession}
        pairTvProvides={pairTvProvides}
        pairEnterOnTv={pairEnterOnTv}
        pairPinInput={pairPinInput}
        onPairPinInputChange={setPairPinInput}
        pairBusy={pairBusy}
        onStartPair={startPair}
        onCompletePair={completePairFromTv}
      />
    </div>
  )
}
