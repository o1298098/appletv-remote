import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { AtvKeyboardState } from "@/lib/api"
import { keyboardStreamUrl, keyboardRemoteOp } from "@/lib/api"
import { cn } from "@/lib/utils"

/** 停止输入后多久把整段文字 text_set 到电视（过短易与 SSE 轮询打架，电视端可能叠字） */
const REALTIME_DEBOUNCE_MS = 280

/**
 * 订阅后端键盘 SSE：tvOS 搜索框等获得焦点时（pyatv TextFocusState → Focused）自动弹出输入。
 */
export function KeyboardAutoDialog({
  deviceId,
  enabled,
}: {
  deviceId: string
  enabled: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState("")
  const dismissedRef = useRef(false)
  const userEditedRef = useRef(false)
  const openRef = useRef(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const draftRef = useRef(draft)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const syncGenRef = useRef(0)

  openRef.current = open
  draftRef.current = draft

  useEffect(() => {
    dismissedRef.current = false
    userEditedRef.current = false
    setOpen(false)
    setDraft("")
  }, [deviceId])

  useEffect(() => {
    if (!enabled || !deviceId || typeof EventSource === "undefined") {
      return
    }

    const url = keyboardStreamUrl(deviceId)
    let es: EventSource
    try {
      es = new EventSource(url)
    } catch {
      return
    }

    es.onmessage = (ev) => {
      try {
        const s = JSON.parse(ev.data) as AtvKeyboardState
        const focus = s.text_focus_state
        if (focus === "Focused") {
          const next = s.text ?? ""
          // 关窗后 dismissed 时原先直接 return，草稿从不随电视更新，再次弹出仍显示旧字。
          // 只要用户没在本地编辑，始终用电视端文本刷新草稿（关窗时在后台同步亦可）。
          if (!userEditedRef.current) {
            setDraft(next)
          }
          if (dismissedRef.current) {
            return
          }
          if (!openRef.current) {
            setOpen(true)
          }
        } else {
          dismissedRef.current = false
          userEditedRef.current = false
          setOpen(false)
          setDraft("")
        }
      } catch {
        /* 忽略畸形帧 */
      }
    }

    return () => {
      es.close()
    }
  }, [deviceId, enabled])

  useEffect(() => {
    if (open && areaRef.current) {
      const tId = window.setTimeout(() => {
        areaRef.current?.focus()
        // 不 select 全选：避免部分环境下与受控 value 叠加产生怪异编辑行为
      }, 50)
      return () => window.clearTimeout(tId)
    }
  }, [open])

  useEffect(() => {
    if (!open || !deviceId) {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
      return
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }

    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null
      if (!openRef.current || !userEditedRef.current) return

      const myGen = (syncGenRef.current += 1)
      const text = draftRef.current

      void (async () => {
        try {
          const s = await keyboardRemoteOp(deviceId, { op: "set", text })
          if (myGen !== syncGenRef.current) return
          // 发送期间用户若继续输入，勿用电视结果覆盖新草稿
          if (draftRef.current !== text) return
          const tv = s.text ?? text
          userEditedRef.current = false
          setDraft(tv)
        } catch (e) {
          if (myGen !== syncGenRef.current) return
          toast.error(
            e instanceof Error ? e.message : t("keyboardAuto.sendFailed"),
          )
        }
      })()
    }, REALTIME_DEBOUNCE_MS)

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [draft, open, deviceId, t])

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      dismissedRef.current = true
      userEditedRef.current = false
      syncGenRef.current += 1
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
    setOpen(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-[calc(100%-2rem)] sm:max-w-md"
        showCloseButton
      >
        <DialogHeader>
          <DialogTitle>{t("keyboardAuto.title")}</DialogTitle>
          <DialogDescription>{t("keyboardAuto.description")}</DialogDescription>
        </DialogHeader>
        <textarea
          ref={areaRef}
          value={draft}
          onChange={(e) => {
            userEditedRef.current = true
            setDraft(e.target.value)
          }}
          rows={4}
          placeholder={t("keyboardAuto.placeholder")}
          className={cn(
            "border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-y rounded-lg border px-2.5 py-2 font-mono text-sm transition-colors outline-none focus-visible:ring-3 dark:bg-input/30",
          )}
        />
      </DialogContent>
    </Dialog>
  )
}
