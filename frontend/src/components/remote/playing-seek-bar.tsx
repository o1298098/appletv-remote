import { useCallback, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

export function PlayingSeekBar({
  positionSec,
  totalSec,
  disabled,
  onSeek,
  ariaLabel,
}: {
  positionSec: number
  totalSec: number
  disabled: boolean
  onSeek: (sec: number) => void
  ariaLabel: string
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const positionRef = useRef(positionSec)
  positionRef.current = positionSec
  const draggingRef = useRef(false)
  const activePointerId = useRef<number | null>(null)
  const scrubRef = useRef(positionSec)

  const [dragging, setDragging] = useState(false)
  const [scrub, setScrub] = useState(positionSec)
  const [pendingCommit, setPendingCommit] = useState<number | null>(null)

  useEffect(() => {
    if (dragging) return
    if (pendingCommit != null) {
      if (Math.abs(positionSec - pendingCommit) <= 3) {
        setPendingCommit(null)
        setScrub(positionSec)
        scrubRef.current = positionSec
      }
      return
    }
    setScrub(positionSec)
    scrubRef.current = positionSec
  }, [positionSec, dragging, pendingCommit])

  useEffect(() => {
    if (pendingCommit == null) return
    const id = window.setTimeout(() => setPendingCommit(null), 12000)
    return () => window.clearTimeout(id)
  }, [pendingCommit])

  const applyCommit = useCallback(
    (raw: number) => {
      const v = Math.min(totalSec, Math.max(0, Math.round(raw)))
      setPendingCommit(v)
      setScrub(v)
      scrubRef.current = v
      void onSeek(v)
    },
    [totalSec, onSeek],
  )

  const clientXToSec = useCallback(
    (clientX: number) => {
      const el = trackRef.current
      if (!el || totalSec <= 0) return scrubRef.current
      const rect = el.getBoundingClientRect()
      const w = rect.width
      if (w <= 0) return scrubRef.current
      const r = (clientX - rect.left) / w
      return Math.min(totalSec, Math.max(0, Math.round(r * totalSec)))
    },
    [totalSec],
  )

  const writeScrub = (sec: number) => {
    const v = Math.min(totalSec, Math.max(0, Math.round(sec)))
    scrubRef.current = v
    setScrub(v)
  }

  const pct = Math.min(100, Math.max(0, (scrub / totalSec) * 100))

  const endGesture = (
    ev: React.PointerEvent<HTMLDivElement>,
    commit: boolean,
  ) => {
    const pid = activePointerId.current
    if (pid == null || ev.pointerId !== pid) return
    activePointerId.current = null
    draggingRef.current = false
    setDragging(false)
    try {
      ev.currentTarget.releasePointerCapture(pid)
    } catch {
      /* */
    }
    if (commit) {
      applyCommit(scrubRef.current)
    } else {
      const r = positionRef.current
      scrubRef.current = r
      setScrub(r)
    }
  }

  const onTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const t = e.currentTarget
    try {
      t.setPointerCapture(e.pointerId)
    } catch {
      return
    }
    activePointerId.current = e.pointerId
    draggingRef.current = true
    setDragging(true)
    writeScrub(clientXToSec(e.clientX))
  }

  const onTrackPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || activePointerId.current !== e.pointerId) {
      return
    }
    e.preventDefault()
    writeScrub(clientXToSec(e.clientX))
  }

  const onTrackPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== e.pointerId) return
    endGesture(e, true)
  }

  const onTrackPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== e.pointerId) return
    endGesture(e, false)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    const step = Math.max(1, Math.round(totalSec / 60))
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault()
      writeScrub(scrubRef.current - step)
      applyCommit(scrubRef.current)
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault()
      writeScrub(scrubRef.current + step)
      applyCommit(scrubRef.current)
    } else if (e.key === "Home") {
      e.preventDefault()
      writeScrub(0)
      applyCommit(0)
    } else if (e.key === "End") {
      e.preventDefault()
      writeScrub(totalSec)
      applyCommit(totalSec)
    }
  }

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={totalSec}
      aria-valuenow={scrub}
      aria-disabled={disabled}
      data-dragging={dragging || undefined}
      className={cn(
        "relative flex h-5 cursor-pointer touch-none items-center rounded-sm select-none py-0",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
        disabled && "pointer-events-none cursor-not-allowed opacity-45",
      )}
      onPointerDown={onTrackPointerDown}
      onPointerMove={onTrackPointerMove}
      onPointerUp={onTrackPointerUp}
      onPointerCancel={onTrackPointerCancel}
      onKeyDown={onKeyDown}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-background/50 dark:bg-background/20"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute top-1/2 left-0 h-0.5 max-w-full -translate-y-1/2 rounded-full bg-foreground/70 dark:bg-foreground/80"
        style={{ width: `${pct}%` }}
        aria-hidden
      />
      <div
        className={cn(
          "border-background bg-foreground pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-sm transition-opacity duration-150",
          dragging ? "opacity-100" : "opacity-65",
        )}
        style={{ left: `${pct}%` }}
        aria-hidden
      />
    </div>
  )
}
