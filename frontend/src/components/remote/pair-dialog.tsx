import { Loader2 } from "lucide-react"
import { Trans, useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { AtvDevice } from "@/lib/api"

export function PairDialog({
  open,
  onClose,
  devices,
  pairDeviceId,
  onPairDeviceIdChange,
  pairSession,
  pairTvProvides,
  pairEnterOnTv,
  pairPinInput,
  onPairPinInputChange,
  pairBusy,
  onStartPair,
  onCompletePair,
}: {
  open: boolean
  onClose: () => void
  devices: AtvDevice[]
  pairDeviceId: string
  onPairDeviceIdChange: (id: string) => void
  pairSession: string | null
  pairTvProvides: boolean
  pairEnterOnTv: string | null
  pairPinInput: string
  onPairPinInputChange: (v: string) => void
  pairBusy: boolean
  onStartPair: () => void | Promise<void>
  onCompletePair: () => void | Promise<void>
}) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
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
                onValueChange={(v) => onPairDeviceIdChange(v ?? "")}
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
              <Button variant="ghost" type="button" onClick={onClose}>
                {t("actions.cancel")}
              </Button>
              <Button
                type="button"
                disabled={pairBusy || devices.length === 0}
                onClick={() => void onStartPair()}
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
              onChange={(e) => onPairPinInputChange(e.target.value)}
            />
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="ghost" type="button" onClick={onClose}>
                {t("actions.cancel")}
              </Button>
              <Button
                type="button"
                disabled={pairBusy || !pairPinInput.trim()}
                onClick={() => void onCompletePair()}
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
              <Button variant="ghost" type="button" onClick={onClose}>
                {t("actions.cancel")}
              </Button>
              <Button
                type="button"
                disabled={pairBusy}
                onClick={() => void onCompletePair()}
              >
                {t("pair.finish")}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
