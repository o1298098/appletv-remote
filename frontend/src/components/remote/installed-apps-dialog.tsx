import { useCallback, useEffect, useState } from "react"
import { LayoutGrid, Loader2, RefreshCw } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  fetchInstalledApps,
  launchAtvApp,
  type AtvInstalledApp,
} from "@/lib/api"

const APP_AVATAR_SWATCHES = [
  "bg-orange-200 text-orange-950 dark:bg-orange-950/80 dark:text-orange-100",
  "bg-sky-200 text-sky-950 dark:bg-sky-950/80 dark:text-sky-100",
  "bg-violet-200 text-violet-950 dark:bg-violet-950/80 dark:text-violet-100",
  "bg-emerald-200 text-emerald-950 dark:bg-emerald-950/80 dark:text-emerald-100",
  "bg-rose-200 text-rose-950 dark:bg-rose-950/80 dark:text-rose-100",
  "bg-amber-200 text-amber-950 dark:bg-amber-950/80 dark:text-amber-100",
  "bg-cyan-200 text-cyan-950 dark:bg-cyan-950/80 dark:text-cyan-100",
  "bg-fuchsia-200 text-fuchsia-950 dark:bg-fuchsia-950/80 dark:text-fuchsia-100",
]

function hashBundleId(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i += 1) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

function AppLetterAvatar({
  displayName,
  bundleId,
}: {
  displayName: string
  bundleId: string
}) {
  const raw = displayName.trim()
  const letter = (
    raw.match(/[\p{L}\p{N}]/u)?.[0] ?? bundleId.slice(-1) ?? "?"
  ).toUpperCase()
  const swatch =
    APP_AVATAR_SWATCHES[hashBundleId(bundleId) % APP_AVATAR_SWATCHES.length]

  return (
    <div
      className={`flex size-10 shrink-0 items-center justify-center rounded-[0.65rem] text-[0.8125rem] font-semibold shadow-sm ring-1 ring-black/5 dark:ring-white/10 ${swatch}`}
      aria-hidden
    >
      {letter}
    </div>
  )
}

function AppRowIcon({
  displayName,
  bundleId,
  iconUrl,
}: {
  displayName: string
  bundleId: string
  iconUrl: string | null | undefined
}) {
  const [broken, setBroken] = useState(false)

  useEffect(() => {
    setBroken(false)
  }, [iconUrl])

  const url = iconUrl?.trim()
  if (url && /^https:\/\//i.test(url) && !broken) {
    return (
      <img
        src={url}
        alt=""
        className="size-10 shrink-0 rounded-[0.65rem] object-cover shadow-sm ring-1 ring-black/5 dark:ring-white/10"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
      />
    )
  }

  return <AppLetterAvatar displayName={displayName} bundleId={bundleId} />
}

export function InstalledAppsDialogTrigger({
  deviceId,
}: {
  deviceId: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-9 shrink-0 touch-manipulation"
        onClick={() => setOpen(true)}
        title={t("apps.button")}
        aria-label={t("apps.buttonAria")}
      >
        <LayoutGrid className="size-4 opacity-80" />
      </Button>
      <InstalledAppsDialogContent
        deviceId={deviceId}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  )
}

function InstalledAppsDialogContent({
  deviceId,
  open,
  onOpenChange,
}: {
  deviceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [apps, setApps] = useState<AtvInstalledApp[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [launchingId, setLaunchingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await fetchInstalledApps(deviceId)
      setApps(list)
    } catch (e) {
      setApps([])
      setError(e instanceof Error ? e.message : t("apps.loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [deviceId, t])

  useEffect(() => {
    if (open && deviceId) void load()
  }, [open, deviceId, load])

  const onLaunch = async (app: AtvInstalledApp) => {
    const target = app.identifier
    if (!target || launchingId) return
    setLaunchingId(target)
    try {
      await launchAtvApp(deviceId, target)
      toast.success(t("apps.toastLaunched", { name: app.name ?? target }))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("apps.launchFailed"))
    } finally {
      setLaunchingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(85dvh,32rem)] max-w-[calc(100%-2rem)] flex-col gap-0 p-0 sm:max-w-md"
        showCloseButton
      >
        <DialogHeader className="shrink-0 space-y-0 border-b px-4 py-3 pr-12">
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="text-base">{t("apps.title")}</DialogTitle>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground h-8 shrink-0 gap-1.5 px-2 text-xs"
              disabled={loading}
              onClick={() => void load()}
              title={t("apps.refresh")}
            >
              {loading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5 opacity-80" />
              )}
              {t("apps.refresh")}
            </Button>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 px-2 py-3">
          {loading && apps.length === 0 ? (
            <div className="text-muted-foreground flex items-center gap-2 px-2 py-8 text-sm">
              <Loader2 className="size-4 shrink-0 animate-spin" />
              {t("apps.loading")}
            </div>
          ) : error ? (
            <p className="text-muted-foreground px-2 py-4 text-sm leading-snug">
              {error}
            </p>
          ) : apps.length === 0 ? (
            <p className="text-muted-foreground px-2 py-4 text-sm">
              {t("apps.empty")}
            </p>
          ) : (
            <ScrollArea className="h-[min(60dvh,22rem)] pr-2">
              <ul className="flex flex-col gap-0.5 pb-1">
                {apps.map((app) => {
                  const label = app.name?.trim() || app.identifier
                  const busy = launchingId === app.identifier
                  return (
                    <li key={app.identifier}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onLaunch(app)}
                        className="hover:bg-muted/80 flex w-full min-w-0 items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors disabled:opacity-60"
                      >
                        <div className="relative shrink-0">
                          <AppRowIcon
                            displayName={label}
                            bundleId={app.identifier}
                            iconUrl={app.icon_url}
                          />
                          {busy ? (
                            <div className="bg-background/70 absolute inset-0 flex items-center justify-center rounded-[0.65rem] backdrop-blur-[1px]">
                              <Loader2 className="text-muted-foreground size-4 animate-spin" />
                            </div>
                          ) : null}
                        </div>
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {label}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
