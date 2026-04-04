import React, { useCallback, useRef } from "react"

const LONG_PRESS_MS = 450

export type RemotePush = (
  command: string,
  extra?: { action?: string; position_sec?: number },
) => void | Promise<void>

export function useRemotePressHandlers(
  push: RemotePush,
  command: string,
  disabled: boolean,
  supportsHold: boolean,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longFiredRef = useRef(false)
  const downAtRef = useRef(0)
  const ignoreClickRef = useRef(false)

  const clearLongTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (disabled || !supportsHold) return
      e.currentTarget.setPointerCapture(e.pointerId)
      longFiredRef.current = false
      downAtRef.current = Date.now()
      clearLongTimer()
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        longFiredRef.current = true
        ignoreClickRef.current = true
        void push(command, { action: "hold" })
      }, LONG_PRESS_MS)
    },
    [clearLongTimer, command, disabled, push, supportsHold],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      clearLongTimer()
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {}
      if (disabled || !supportsHold) return
      const elapsed = Date.now() - downAtRef.current
      if (!longFiredRef.current && elapsed < LONG_PRESS_MS) {
        ignoreClickRef.current = true
        void push(command)
      }
      longFiredRef.current = false
    },
    [clearLongTimer, command, disabled, push, supportsHold],
  )

  const onPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      clearLongTimer()
      longFiredRef.current = false
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {}
    },
    [clearLongTimer],
  )

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (!supportsHold) {
        void push(command)
        return
      }
      if (ignoreClickRef.current) {
        ignoreClickRef.current = false
        e.preventDefault()
        e.stopPropagation()
        return
      }
      void push(command)
    },
    [command, push, supportsHold],
  )

  if (!supportsHold) {
    return { onClick }
  }

  return {
    onPointerDown,
    onPointerUp,
    onPointerCancel,
    onPointerLeave: onPointerCancel,
    onClick,
  }
}
