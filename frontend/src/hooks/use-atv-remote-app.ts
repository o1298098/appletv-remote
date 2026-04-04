import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import type { AtvDevice, PlayingSnapshot } from "@/lib/api"
import {
  disconnectDevice,
  fetchPlaying,
  healthCheck,
  pairBegin,
  pairCancel,
  pairFinish,
  pairPin,
  scanDevices,
  sendRemote,
} from "@/lib/api"
import { resolveSelectedAfterScan } from "@/lib/atv-device-utils"
import { PLAYING_FETCH_FAILED_MARKER, STORAGE_KEY } from "@/lib/atv-remote-constants"

export function useAtvRemoteApp() {
  const { t, i18n } = useTranslation()
  const [devices, setDevices] = useState<AtvDevice[]>([])
  const [selectedId, setSelectedId] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) ?? ""
    } catch {
      return ""
    }
  })
  const [scanning, setScanning] = useState(false)
  const sendingRef = useRef(false)
  const [backendOk, setBackendOk] = useState(true)

  const [pairOpen, setPairOpen] = useState(false)
  const [pairDeviceId, setPairDeviceId] = useState("")
  const [pairSession, setPairSession] = useState<string | null>(null)
  const [pairTvProvides, setPairTvProvides] = useState(false)
  const [pairEnterOnTv, setPairEnterOnTv] = useState<string | null>(null)
  const [pairPinInput, setPairPinInput] = useState("")
  const [pairBusy, setPairBusy] = useState(false)

  const [mobileSheetOpen, setMobileSheetOpen] = useState(false)
  const [playingSnap, setPlayingSnap] = useState<PlayingSnapshot | null>(null)
  const [playingInitial, setPlayingInitial] = useState(true)

  const selected = devices.find((d) => d.identifier === selectedId)
  const selectedIsPaired = Boolean(
    selected?.mrp_credentials || selected?.companion_credentials,
  )

  const credLabelFor = useCallback(
    (d: AtvDevice) =>
      d.mrp_credentials || d.companion_credentials
        ? t("device.paired")
        : t("device.notPaired"),
    [t],
  )

  useEffect(() => {
    document.title = t("app.documentTitle")
  }, [t, i18n.language])

  useEffect(() => {
    if (selectedId) localStorage.setItem(STORAGE_KEY, selectedId)
  }, [selectedId])

  useEffect(() => {
    let cancelled = false
    void healthCheck().then((ok) => {
      if (!cancelled) setBackendOk(ok)
    })
    const tId = window.setInterval(() => {
      void healthCheck().then((ok) => {
        if (!cancelled) setBackendOk(ok)
      })
    }, 15000)
    return () => {
      cancelled = true
      window.clearInterval(tId)
    }
  }, [])

  const handleScan = useCallback(async (opts?: { silent?: boolean }) => {
    setScanning(true)
    try {
      const list = await scanDevices()
      setDevices(list)
      setSelectedId((prev) => resolveSelectedAfterScan(list, prev))
      if (list.length === 0) {
        if (!opts?.silent) {
          toast.message(t("toast.noDevicesTitle"), {
            description: t("toast.noDevicesDesc"),
          })
        }
        return
      }
      if (!opts?.silent) {
        toast.success(t("toast.devicesFound", { count: list.length }))
      }
    } catch (e) {
      if (!opts?.silent) {
        toast.error(e instanceof Error ? e.message : t("toast.scanFailed"))
      }
    } finally {
      setScanning(false)
    }
  }, [t])

  useEffect(() => {
    void handleScan({ silent: true })
  }, [handleScan])

  useEffect(() => {
    if (!selectedId || !selectedIsPaired) {
      setPlayingSnap(null)
      setPlayingInitial(true)
      return
    }
    setPlayingSnap(null)
    setPlayingInitial(true)
    let cancelled = false
    const tick = async () => {
      try {
        const s = await fetchPlaying(selectedId)
        if (!cancelled) {
          setPlayingSnap(s)
          setPlayingInitial(false)
        }
      } catch {
        if (!cancelled) {
          setPlayingInitial(false)
          setPlayingSnap((prev) =>
            prev ?? {
              supported: false,
              detail: PLAYING_FETCH_FAILED_MARKER,
            },
          )
        }
      }
    }
    void tick()
    const id = window.setInterval(tick, 2500)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [selectedId, selectedIsPaired])

  const push = useCallback(
    async (
      command: string,
      extra?: { action?: string; position_sec?: number },
    ) => {
      if (!selectedId) {
        toast.error(t("toast.selectAtvFirst"))
        return
      }
      if (sendingRef.current) {
        return
      }
      sendingRef.current = true
      try {
        await sendRemote(selectedId, command, extra)
        if (command === "set_position") {
          await new Promise((r) => window.setTimeout(r, 280))
          try {
            const s = await fetchPlaying(selectedId)
            setPlayingSnap(s)
          } catch {
            /* 轮询会补上 */
          }
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("toast.sendFailed"))
      } finally {
        sendingRef.current = false
      }
    },
    [selectedId, t],
  )

  const handleDisconnect = useCallback(async () => {
    if (!selectedId) return
    try {
      await disconnectDevice(selectedId)
      toast.success(t("toast.disconnected"))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toast.disconnectFailed"))
    }
  }, [selectedId, t])

  const resetPairUi = () => {
    setPairSession(null)
    setPairTvProvides(false)
    setPairEnterOnTv(null)
    setPairPinInput("")
    setPairBusy(false)
  }

  const openPairDialog = () => {
    resetPairUi()
    setPairDeviceId(selectedId || devices[0]?.identifier || "")
    setPairOpen(true)
  }

  const closePairDialog = () => {
    if (pairSession) void pairCancel(pairSession)
    resetPairUi()
    setPairOpen(false)
  }

  const startPair = async () => {
    if (!pairDeviceId) {
      toast.error(t("pair.chooseDeviceFirst"))
      return
    }
    setPairBusy(true)
    try {
      const r = await pairBegin(pairDeviceId)
      setPairSession(r.session_id)
      setPairTvProvides(r.device_provides_pin)
      setPairEnterOnTv(r.enter_on_tv_pin)
      toast.message(t("toast.pairStarted"), {
        description: t("toast.pairProtocol", { protocol: r.protocol }),
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toast.pairStartFailed"))
    } finally {
      setPairBusy(false)
    }
  }

  const completePairFromTv = async () => {
    if (!pairSession) return
    setPairBusy(true)
    try {
      if (pairTvProvides) {
        await pairPin(pairSession, pairPinInput.trim())
      }
      const ok = await pairFinish(pairSession)
      if (ok) {
        toast.success(t("toast.pairSuccess"))
        await handleScan()
      } else toast.error(t("toast.pairIncomplete"))
      resetPairUi()
      setPairOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toast.pairFailed"))
    } finally {
      setPairBusy(false)
    }
  }

  return {
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
    closePairDialog,
    startPair,
    completePairFromTv,
  }
}
