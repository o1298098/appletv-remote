import { useEffect, useRef, useState } from "react"
import { Hand } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  touchActionRemote,
  touchClickRemote,
  touchSwipeRemote,
  touchWsUrl,
} from "@/lib/api"
import { cn } from "@/lib/utils"

/** 轻点：像素位移须同时满足；略放宽以容忍手抖。 */
const TAP_MAX_MOVE_PX = 52
/** 虚拟板 0–1000 上总位移须很小才判为轻点（与 TAP_MAX_MOVE_PX 用 AND，避免竖滑被误判成点按）。 */
const TAP_MODEL_MAX = 38
/** 连续触控模式下，最小位移阈值（虚拟板 0-1000 坐标系）。 */
const HOLD_STEP_MODEL = 3
/** 连续触控模式下，最小发送间隔，避免事件过密。 */
const HOLD_MIN_INTERVAL_MS = 16
/** 相对位移放大系数（越大越灵敏，越接近触摸板“推指针”感觉）。 */
const TRACKPAD_GAIN = 0.78
/** 微小抖动死区（像素），用于“悬停”在同一图标附近。 */
const TRACKPAD_DEADZONE_PX = 0.6

function clientToPadModel(
  el: HTMLElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const r = el.getBoundingClientRect()
  const x = Math.max(
    0,
    Math.min(1000, Math.round(((clientX - r.left) / r.width) * 1000)),
  )
  const y = Math.max(
    0,
    Math.min(1000, Math.round(((clientY - r.top) / r.height) * 1000)),
  )
  return { x, y }
}

function swipeDurationMs(dt: number, distPx: number, modelDist: number): number {
  const speed = distPx / Math.max(dt, 6)
  const flick = 115 + 280 / Math.sqrt(speed + 0.12)
  const track = dt * 0.92 + 42
  let ms = Math.round(Math.max(115, Math.min(1000, Math.min(flick, track))))
  // 位移不大时略拉长时长，tvOS 更容易吃到滑动手势
  if (modelDist < 200) {
    ms = Math.max(ms, 135)
  }
  return ms
}

function isTapGesture(
  distPx: number,
  sx: number,
  sy: number,
  ex: number,
  ey: number,
): boolean {
  const dx = Math.abs(ex - sx)
  const dy = Math.abs(ey - sy)
  const modelDist = Math.hypot(dx, dy)
  const dominant = Math.max(dx, dy)
  const minor = Math.min(dx, dy)
  // 沿单轴为主的移动（典型上下/左右滑）一律按滑动，避免被 modelDist 误判成轻点
  if (dominant >= 24 && minor <= 22) {
    return false
  }
  return distPx < TAP_MAX_MOVE_PX && modelDist < TAP_MODEL_MAX
}

function touchHaptic() {
  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(8)
    }
  } catch {
    /* ignore */
  }
}

export type RemoteTouchPadProps = {
  deviceId: string
  /** When true, no touch API calls and the pad is non-interactive. */
  disabled?: boolean
  className?: string
  padClassName?: string
  hintClassName?: string
  showHint?: boolean
  /** i18n key for the hint paragraph (default: mobile-oriented `card.touchPadHint`). */
  hintTranslationKey?: string
  showClickButtons?: boolean
  /** 中央手型示意；默认关闭，更接近系统遥控空白触摸区。 */
  showCenterHand?: boolean
  clickButtonSize?: "default" | "sm"
  clickRowClassName?: string
}

export function RemoteTouchPad({
  deviceId,
  disabled = false,
  className,
  padClassName,
  hintClassName,
  showHint = true,
  hintTranslationKey = "card.touchPadHint",
  showClickButtons = true,
  showCenterHand = false,
  clickButtonSize = "sm",
  clickRowClassName,
}: RemoteTouchPadProps) {
  const { t } = useTranslation()
  const padRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    pointerId: number
    gid: number
    sx: number
    sy: number
    cx: number
    cy: number
    t: number
    lx: number
    ly: number
    vx: number
    vy: number
    lcx: number
    lcy: number
    lt: number
    lastEmitAt: number
    moved: boolean
    pressSent: boolean
  } | null>(null)
  const lastClientRef = useRef({ x: 0, y: 0 })
  const gestureSeqRef = useRef(0)
  const actionQueueRef = useRef<Promise<void>>(Promise.resolve())
  const pendingHoldRef = useRef<{ x: number; y: number; gid?: number } | null>(
    null,
  )
  const drainingHoldRef = useRef(false)
  const touchWsRef = useRef<WebSocket | null>(null)
  const touchWsConnectingRef = useRef(false)
  /** True after pointer path committed a gesture; clears on next pointerdown or after click dedup. */
  const pointerGestureCommittedRef = useRef(false)
  const ctxRef = useRef({
    inactive: false as boolean,
    deviceId: "" as string,
    t: ((k: string) => k) as (k: string) => string,
  })
  ctxRef.current = {
    inactive: disabled || !deviceId,
    deviceId,
    t,
  }

  const [busy, setBusy] = useState(false)

  const inactive = disabled || !deviceId
  const blockInteraction = inactive || busy

  const runTouchOrSwipe = (
    el: HTMLElement,
    d: NonNullable<(typeof dragRef)["current"]>,
    endClientX: number,
    endClientY: number,
  ) => {
    const { x, y } = clientToPadModel(el, endClientX, endClientY)
    const distPx = Math.hypot(endClientX - d.cx, endClientY - d.cy)
    const dt = Math.max(1, Date.now() - d.t)
    const { deviceId: id, t: tr } = ctxRef.current
    const tap = isTapGesture(distPx, d.sx, d.sy, x, y)
    const modelDist = Math.hypot(x - d.sx, y - d.sy)

    void (async () => {
      try {
        touchHaptic()
        if (tap) {
          await touchActionRemote(id, { x: d.sx, y: d.sy, mode: 5 })
        } else {
          const duration_ms = swipeDurationMs(dt, distPx, modelDist)
          await touchSwipeRemote(id, {
            start_x: d.sx,
            start_y: d.sy,
            end_x: x,
            end_y: y,
            duration_ms,
          })
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : tr("advanced.touchFailed"),
        )
      }
    })()
  }

  const queueTouchAction = (
    x: number,
    y: number,
    mode: 1 | 3 | 4 | 5,
    gid?: number,
    reportError = false,
  ) => {
    const ws = touchWsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "action", x, y, mode, gid }))
      } catch (err) {
        if (!reportError) return
        const tr = ctxRef.current.t
        toast.error(
          err instanceof Error ? err.message : tr("advanced.touchFailed"),
        )
      }
      return
    }

    const { deviceId: id, t: tr } = ctxRef.current
    actionQueueRef.current = actionQueueRef.current.then(async () => {
      try {
        await touchActionRemote(id, { x, y, mode })
      } catch (err) {
        if (!reportError) return
        toast.error(
          err instanceof Error ? err.message : tr("advanced.touchFailed"),
        )
      }
    })
  }

  const queueHoldLatest = (x: number, y: number, gid?: number) => {
    const ws = touchWsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "action", x, y, mode: 3, gid }))
      } catch {
        // WS 失败则回退到 HTTP 队列路径
      }
      return
    }

    pendingHoldRef.current = { x, y, gid }
    if (drainingHoldRef.current) return
    drainingHoldRef.current = true
    actionQueueRef.current = actionQueueRef.current.then(async () => {
      while (pendingHoldRef.current) {
        const next = pendingHoldRef.current
        pendingHoldRef.current = null
        try {
          const ws = touchWsRef.current
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "action",
                x: next.x,
                y: next.y,
                mode: 3,
                gid: next.gid,
              }),
            )
          } else {
            await touchActionRemote(ctxRef.current.deviceId, { ...next, mode: 3 })
          }
        } catch {
          // 连续移动失败时忽略单次点，避免高频 toast 干扰交互。
        }
      }
      drainingHoldRef.current = false
      const pending = pendingHoldRef.current as
        | { x: number; y: number; gid?: number }
        | null
      if (pending) {
        queueHoldLatest(pending.x, pending.y, pending.gid)
      }
    })
  }

  const runTapAtClient = (el: HTMLElement, clientX: number, clientY: number) => {
    const { x, y } = clientToPadModel(el, clientX, clientY)
    const { deviceId: id, t: tr } = ctxRef.current
    void (async () => {
      try {
        touchHaptic()
        await touchActionRemote(id, { x, y, mode: 5 })
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : tr("advanced.touchFailed"),
        )
      }
    })()
  }

  useEffect(() => {
    if (!deviceId || disabled) return
    if (touchWsRef.current || touchWsConnectingRef.current) return
    touchWsConnectingRef.current = true
    const ws = new WebSocket(touchWsUrl(deviceId))
    ws.onopen = () => {
      touchWsRef.current = ws
      touchWsConnectingRef.current = false
    }
    ws.onclose = () => {
      if (touchWsRef.current === ws) {
        touchWsRef.current = null
      }
      touchWsConnectingRef.current = false
    }
    ws.onerror = () => {
      // 留给 HTTP 回退处理，不打断用户手势。
    }
    return () => {
      if (touchWsRef.current === ws) touchWsRef.current = null
      touchWsConnectingRef.current = false
      try {
        ws.close()
      } catch {
        /* ignore */
      }
    }
  }, [deviceId, disabled])

  useEffect(() => {
    const el = padRef.current
    if (!el) return

    const opts: AddEventListenerOptions = { passive: false }

    const block = () => ctxRef.current.inactive

    const onPointerDown = (e: PointerEvent) => {
      if (block()) return
      if (!e.isPrimary) return
      if (e.pointerType === "mouse" && e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      pointerGestureCommittedRef.current = false
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      const { x, y } = clientToPadModel(el, e.clientX, e.clientY)
      lastClientRef.current = { x: e.clientX, y: e.clientY }
      dragRef.current = {
        pointerId: e.pointerId,
        gid: ++gestureSeqRef.current,
        sx: x,
        sy: y,
        cx: e.clientX,
        cy: e.clientY,
        t: Date.now(),
        // 连续模式采用相对位移，触点从中心开始更接近官方手感。
        lx: 500,
        ly: 500,
        vx: 500,
        vy: 500,
        lcx: e.clientX,
        lcy: e.clientY,
        lt: Date.now(),
        lastEmitAt: 0,
        moved: false,
        pressSent: false,
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d || d.pointerId !== e.pointerId) return
      lastClientRef.current = { x: e.clientX, y: e.clientY }
      e.preventDefault()
      if (ctxRef.current.inactive) return

      const now = Date.now()
      if (now - d.lastEmitAt < HOLD_MIN_INTERVAL_MS) return
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) return
      const dxPx = e.clientX - d.lcx
      const dyPx = e.clientY - d.lcy
      const deltaPx = Math.hypot(dxPx, dyPx)
      if (deltaPx < TRACKPAD_DEADZONE_PX) {
        d.lcx = e.clientX
        d.lcy = e.clientY
        return
      }
      const dxModel = (dxPx / r.width) * 1000 * TRACKPAD_GAIN
      const dyModel = (dyPx / r.height) * 1000 * TRACKPAD_GAIN

      d.vx = Math.max(0, Math.min(1000, d.vx + dxModel))
      d.vy = Math.max(0, Math.min(1000, d.vy + dyModel))
      const x = Math.round(d.vx)
      const y = Math.round(d.vy)
      const modelDelta = Math.hypot(x - d.lx, y - d.ly)

      if (!d.pressSent) {
        d.pressSent = true
        queueTouchAction(d.lx, d.ly, 1, d.gid)
      }

      if (modelDelta >= HOLD_STEP_MODEL) {
        queueHoldLatest(x, y, d.gid)
        d.lx = x
        d.ly = y
        d.lastEmitAt = now
      }

      d.lcx = e.clientX
      d.lcy = e.clientY
      d.lt = now
      d.moved = true
    }

    const finishPointer = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d || d.pointerId !== e.pointerId) return
      dragRef.current = null
      try {
        el.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      if (ctxRef.current.inactive) return

      pointerGestureCommittedRef.current = true
      if (d.pressSent) {
        pendingHoldRef.current = null
        const x = Math.round(d.vx)
        const y = Math.round(d.vy)
        const remainModelDist = Math.hypot(x - d.lx, y - d.ly)
        if (remainModelDist >= 4) {
          queueHoldLatest(x, y, d.gid)
        }
        queueTouchAction(x, y, 4, d.gid, true)
        return
      }

      runTouchOrSwipe(el, d, e.clientX, e.clientY)
    }

    const onLostPointerCapture = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d || d.pointerId !== e.pointerId) return
      dragRef.current = null
      if (ctxRef.current.inactive) return
      pointerGestureCommittedRef.current = true
      const lc = lastClientRef.current
      if (d.pressSent) {
        pendingHoldRef.current = null
        const x = Math.round(d.vx)
        const y = Math.round(d.vy)
        const remainModelDist = Math.hypot(x - d.lx, y - d.ly)
        if (remainModelDist >= 4) {
          queueHoldLatest(x, y, d.gid)
        }
        queueTouchAction(x, y, 4, d.gid, true)
        return
      }
      runTouchOrSwipe(el, d, lc.x, lc.y)
    }

    /** iOS / 部分 WebView 上 pointerup 偶发缺失；click 仍会带来坐标。 */
    const onClick = (e: MouseEvent) => {
      if (block()) return
      if (e.button !== 0) return
      if (pointerGestureCommittedRef.current) {
        pointerGestureCommittedRef.current = false
        return
      }
      e.preventDefault()
      runTapAtClient(el, e.clientX, e.clientY)
    }

    el.addEventListener("pointerdown", onPointerDown, opts)
    el.addEventListener("pointermove", onPointerMove, opts)
    el.addEventListener("pointerup", finishPointer, opts)
    el.addEventListener("pointercancel", finishPointer, opts)
    el.addEventListener("lostpointercapture", onLostPointerCapture)
    el.addEventListener("click", onClick)

    return () => {
      el.removeEventListener("pointerdown", onPointerDown, opts)
      el.removeEventListener("pointermove", onPointerMove, opts)
      el.removeEventListener("pointerup", finishPointer, opts)
      el.removeEventListener("pointercancel", finishPointer, opts)
      el.removeEventListener("lostpointercapture", onLostPointerCapture)
      el.removeEventListener("click", onClick)
    }
  }, [])

  const clickBtn = (action: "single" | "double" | "hold") => {
    if (inactive) return
    void (async () => {
      setBusy(true)
      try {
        await touchClickRemote(deviceId, { action })
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : t("advanced.touchFailed"),
        )
      } finally {
        setBusy(false)
      }
    })()
  }

  const padOnly = !showHint && !showClickButtons
  const padSurfaceClass = cn(
    "relative mx-auto flex aspect-[4/3] w-full max-w-[280px] touch-none select-none items-center justify-center rounded-xl border-2 border-dashed border-border/70 bg-muted/30",
    "transition-transform duration-100 ease-out active:scale-[0.985]",
    inactive && "pointer-events-none opacity-50",
    padClassName,
    padOnly && className,
  )

  const padEl = (
    <div
      ref={padRef}
      role="application"
      aria-label={t("advanced.touchPadAria")}
      className={padSurfaceClass}
      style={{ touchAction: "none" }}
    >
      {showCenterHand ? (
        <Hand
          className="text-muted-foreground/40 pointer-events-none size-12"
          strokeWidth={1.25}
          aria-hidden
        />
      ) : null}
    </div>
  )

  if (padOnly) return padEl

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {showHint ? (
        <p
          className={cn(
            "text-muted-foreground text-xs leading-snug",
            hintClassName,
          )}
        >
          {t(hintTranslationKey)}
        </p>
      ) : null}
      {padEl}

      {showClickButtons ? (
        <>
          <Separator />
          <p className="text-muted-foreground text-xs">
            {t("advanced.touchClickRow")}
          </p>
          <div className={cn("flex flex-wrap gap-2", clickRowClassName)}>
            <Button
              type="button"
              size={clickButtonSize}
              variant="outline"
              disabled={blockInteraction}
              className={
                clickButtonSize === "default" ? "min-h-11 flex-1" : undefined
              }
              onClick={() => clickBtn("single")}
            >
              {t("advanced.touchSingle")}
            </Button>
            <Button
              type="button"
              size={clickButtonSize}
              variant="outline"
              disabled={blockInteraction}
              className={
                clickButtonSize === "default" ? "min-h-11 flex-1" : undefined
              }
              onClick={() => clickBtn("double")}
            >
              {t("advanced.touchDouble")}
            </Button>
            <Button
              type="button"
              size={clickButtonSize}
              variant="outline"
              disabled={blockInteraction}
              className={
                clickButtonSize === "default" ? "min-h-11 flex-1" : undefined
              }
              onClick={() => clickBtn("hold")}
            >
              {t("advanced.touchHold")}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  )
}
