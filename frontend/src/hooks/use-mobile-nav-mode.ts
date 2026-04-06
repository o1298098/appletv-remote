import { useCallback, useState } from "react"

const STORAGE_KEY = "atv-remote-mobile-nav-mode"

export type MobileNavMode = "touchpad" | "dpad"

function readStoredMode(): MobileNavMode {
  if (typeof window === "undefined") return "touchpad"
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === "dpad" || v === "touchpad") return v
  } catch {
    /* private mode / quota */
  }
  return "touchpad"
}

function persistMode(mode: MobileNavMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    /* ignore */
  }
}

export function useMobileNavMode() {
  const [mode, setMode] = useState<MobileNavMode>(() => readStoredMode())

  const setMobileNavMode = useCallback((next: MobileNavMode) => {
    persistMode(next)
    setMode(next)
  }, [])

  return { mobileNavMode: mode, setMobileNavMode }
}
