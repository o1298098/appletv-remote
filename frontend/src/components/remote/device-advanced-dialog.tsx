import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import {
  Hand,
  Info,
  Keyboard,
  Loader2,
  RefreshCw,
  SlidersHorizontal,
  UserCircle,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { RemoteTouchPad } from "@/components/remote/remote-touch-pad"
import type {
  AtvDeviceInfo,
  AtvFeatureRow,
  AtvKeyboardState,
  AtvUserAccount,
} from "@/lib/api"
import {
  fetchDeviceFeatures,
  fetchDeviceInfo,
  fetchKeyboardState,
  fetchUserAccounts,
  keyboardRemoteOp,
  switchUserAccount,
} from "@/lib/api"
import { cn } from "@/lib/utils"

type AdvTab = "info" | "keyboard" | "touch" | "accounts"

export function DeviceAdvancedDialogTrigger({
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
        title={t("advanced.button")}
        aria-label={t("advanced.buttonAria")}
      >
        <SlidersHorizontal className="size-4 opacity-80" />
      </Button>
      <DeviceAdvancedDialogContent
        deviceId={deviceId}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  )
}

function DeviceAdvancedDialogContent({
  deviceId,
  open,
  onOpenChange,
}: {
  deviceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<AdvTab>("info")

  const tabBtn = (id: AdvTab, label: string, icon: ReactNode) => (
    <Button
      key={id}
      type="button"
      variant={tab === id ? "secondary" : "ghost"}
      size="sm"
      className="h-9 flex-1 gap-1.5 px-2 text-xs sm:text-sm"
      onClick={() => setTab(id)}
    >
      {icon}
      <span className="truncate">{label}</span>
    </Button>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(88dvh,40rem)] max-w-[calc(100%-2rem)] flex-col gap-0 p-0 sm:max-w-lg"
        showCloseButton
      >
        <DialogHeader className="shrink-0 space-y-0 border-b px-4 py-3 pr-12">
          <DialogTitle className="text-base">{t("advanced.title")}</DialogTitle>
        </DialogHeader>

        <div className="border-b px-2 py-2">
          <div className="flex flex-wrap gap-1">
            {tabBtn(
              "info",
              t("advanced.tabInfo"),
              <Info className="size-3.5 shrink-0 opacity-80" />,
            )}
            {tabBtn(
              "keyboard",
              t("advanced.tabKeyboard"),
              <Keyboard className="size-3.5 shrink-0 opacity-80" />,
            )}
            {tabBtn(
              "touch",
              t("advanced.tabTouch"),
              <Hand className="size-3.5 shrink-0 opacity-80" />,
            )}
            {tabBtn(
              "accounts",
              t("advanced.tabAccounts"),
              <UserCircle className="size-3.5 shrink-0 opacity-80" />,
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden px-3 py-3 sm:px-4">
          {tab === "info" ? (
            <InfoTab deviceId={deviceId} open={open} />
          ) : null}
          {tab === "keyboard" ? (
            <KeyboardTab deviceId={deviceId} open={open} />
          ) : null}
          {tab === "touch" ? (
            <RemoteTouchPad
              deviceId={deviceId}
              hintTranslationKey="advanced.touchPadHint"
              showCenterHand
            />
          ) : null}
          {tab === "accounts" ? (
            <AccountsTab deviceId={deviceId} open={open} />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function InfoTab({ deviceId, open }: { deviceId: string; open: boolean }) {
  const { t } = useTranslation()
  const [info, setInfo] = useState<AtvDeviceInfo | null>(null)
  const [features, setFeatures] = useState<AtvFeatureRow[]>([])
  const [includeUnsup, setIncludeUnsup] = useState(false)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const [di, ft] = await Promise.all([
        fetchDeviceInfo(deviceId),
        fetchDeviceFeatures(deviceId, {
          includeUnsupported: includeUnsup,
        }),
      ])
      setInfo(di)
      setFeatures(ft)
    } catch (e) {
      setInfo(null)
      setFeatures([])
      setErr(e instanceof Error ? e.message : t("advanced.loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [deviceId, includeUnsup, t])

  useEffect(() => {
    if (open && deviceId) void load()
  }, [open, deviceId, load])

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5 opacity-80" />
          )}
          {t("advanced.refresh")}
        </Button>
        <label className="text-muted-foreground flex cursor-pointer items-center gap-2 text-xs">
          <input
            type="checkbox"
            className="accent-primary size-3.5 rounded border"
            checked={includeUnsup}
            onChange={(e) => setIncludeUnsup(e.target.checked)}
          />
          {t("advanced.includeUnsupported")}
        </label>
      </div>

      {err ? (
        <p className="text-destructive text-sm leading-snug">{err}</p>
      ) : null}

      {info ? (
        <div className="bg-muted/40 space-y-1 rounded-lg border border-border/50 px-3 py-2.5 text-sm">
          <p>
            <span className="text-muted-foreground">{t("advanced.model")}</span>{" "}
            {info.model_str}
          </p>
          <p>
            <span className="text-muted-foreground">{t("advanced.os")}</span>{" "}
            {info.operating_system}
            {info.version ? ` ${info.version}` : ""}
            {info.build_number ? ` (${info.build_number})` : ""}
          </p>
          {info.mac ? (
            <p>
              <span className="text-muted-foreground">{t("advanced.mac")}</span>{" "}
              {info.mac}
            </p>
          ) : null}
        </div>
      ) : loading ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          {t("advanced.loadingInfo")}
        </div>
      ) : null}

      <div>
        <p className="text-muted-foreground mb-1.5 text-xs font-medium tracking-wide uppercase">
          {t("advanced.featuresHeading")}
        </p>
        <ScrollArea className="h-[min(40dvh,16rem)] rounded-md border border-border/50">
          <ul className="divide-border/50 divide-y p-0 text-xs sm:text-sm">
            {features.length === 0 && !loading ? (
              <li className="text-muted-foreground px-3 py-4">
                {t("advanced.featuresEmpty")}
              </li>
            ) : null}
            {features.map((f) => (
              <li
                key={f.name}
                className="flex items-start justify-between gap-2 px-3 py-2"
              >
                <span className="min-w-0 break-all font-mono text-[11px] leading-snug sm:text-xs">
                  {f.name}
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                    f.state === "Available"
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                      : f.state === "Unsupported"
                        ? "bg-muted text-muted-foreground"
                        : "bg-amber-500/15 text-amber-800 dark:text-amber-300",
                  )}
                >
                  {f.state}
                </span>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </div>
    </div>
  )
}

function KeyboardTab({ deviceId, open }: { deviceId: string; open: boolean }) {
  const { t } = useTranslation()
  const [state, setState] = useState<AtvKeyboardState | null>(null)
  const [draft, setDraft] = useState("")
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const s = await fetchKeyboardState(deviceId)
      setState(s)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("advanced.keyboardLoadFailed"))
    } finally {
      setLoading(false)
    }
  }, [deviceId, t])

  useEffect(() => {
    if (open && deviceId) void refresh()
  }, [open, deviceId, refresh])

  const run = async (fn: () => Promise<AtvKeyboardState>) => {
    setBusy(true)
    try {
      const s = await fn()
      setState(s)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("advanced.keyboardOpFailed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={loading || busy}
          onClick={() => void refresh()}
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5 opacity-80" />
          )}
          {t("advanced.refresh")}
        </Button>
      </div>

      {state ? (
        <div className="bg-muted/40 rounded-lg border border-border/50 px-3 py-2 text-sm">
          <p>
            <span className="text-muted-foreground">
              {t("advanced.keyboardFocus")}
            </span>{" "}
            {state.text_focus_state}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            {t("advanced.keyboardCurrentText")}
          </p>
          <p className="mt-0.5 max-h-24 overflow-y-auto break-all font-mono text-xs">
            {state.text === null || state.text === ""
              ? t("advanced.keyboardEmpty")
              : state.text}
          </p>
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="kbd-draft" className="text-xs">
          {t("advanced.keyboardDraftLabel")}
        </Label>
        <Input
          id="kbd-draft"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("advanced.keyboardDraftPlaceholder")}
          disabled={busy}
          className="font-mono text-sm"
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(() =>
                keyboardRemoteOp(deviceId, { op: "append", text: draft }),
              )
            }
          >
            {t("advanced.keyboardAppend")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void run(() =>
                keyboardRemoteOp(deviceId, { op: "set", text: draft }),
              )
            }
          >
            {t("advanced.keyboardReplace")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(() => keyboardRemoteOp(deviceId, { op: "clear" }))
            }
          >
            {t("advanced.keyboardClear")}
          </Button>
        </div>
      </div>
    </div>
  )
}

function AccountsTab({ deviceId, open }: { deviceId: string; open: boolean }) {
  const { t } = useTranslation()
  const [accounts, setAccounts] = useState<AtvUserAccount[]>([])
  const [loading, setLoading] = useState(false)
  const [switching, setSwitching] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const list = await fetchUserAccounts(deviceId)
      setAccounts(list)
    } catch (e) {
      setAccounts([])
      setErr(e instanceof Error ? e.message : t("advanced.accountsLoadFailed"))
    } finally {
      setLoading(false)
    }
  }, [deviceId, t])

  useEffect(() => {
    if (open && deviceId) void load()
  }, [open, deviceId, load])

  const onSwitch = (id: string) => {
    void (async () => {
      setSwitching(id)
      try {
        await switchUserAccount(deviceId, id)
        toast.success(t("advanced.accountSwitched"))
        await load()
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : t("advanced.accountSwitchFailed"),
        )
      } finally {
        setSwitching(null)
      }
    })()
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 w-fit gap-1.5 self-start text-xs"
        disabled={loading}
        onClick={() => void load()}
      >
        {loading ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <RefreshCw className="size-3.5 opacity-80" />
        )}
        {t("advanced.refresh")}
      </Button>

      {err ? (
        <p className="text-destructive text-sm leading-snug">{err}</p>
      ) : null}

      {loading && accounts.length === 0 ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          {t("advanced.accountsLoading")}
        </div>
      ) : accounts.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("advanced.accountsEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {accounts.map((a) => {
            const label = a.name?.trim() || a.identifier
            const busy = switching === a.identifier
            return (
              <li key={a.identifier}>
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border/50 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {label}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="shrink-0"
                    disabled={busy || switching !== null}
                    onClick={() => onSwitch(a.identifier)}
                  >
                    {busy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      t("advanced.accountSwitch")
                    )}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
