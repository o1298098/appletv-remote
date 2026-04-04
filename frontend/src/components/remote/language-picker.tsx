import { useState } from "react"
import { Languages } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { LOCALE_STORAGE_KEY, type AppLocale } from "@/i18n/config"

export function LanguagePicker() {
  const { i18n, t } = useTranslation()
  const [open, setOpen] = useState(false)
  const activeZh = i18n.language.startsWith("zh")

  const applyLocale = (next: AppLocale) => {
    void i18n.changeLanguage(next)
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next)
    } catch {}
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
