import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import type { AtvDevice, PlayingSnapshot } from "@/lib/api"
import {
  disconnectDevice,
  fetchPlaying,
  healthCheck,
  playingStreamUrl,
  pairBegin,
  pairCancel,
  pairFinish,
  pairPin,
  scanDevices,
  sendRemote,
} from "@/lib/api"
import {
  findDeviceByIdentifier,
  resolveSelectedAfterScan,
} from "@/lib/atv-device-utils"
import { PLAYING_FETCH_FAILED_MARKER, STORAGE_KEY } from "@/lib/atv-remote-constants"

/** SSE 推送里常不含 app，合并时保留上次 REST 拉到的应用信息。 */
function mergePlayingSnapshot(
  prev: PlayingSnapshot | null,
  incoming: PlayingSnapshot,
): PlayingSnapshot {
  return {
    ...incoming,
    app: incoming.app ?? prev?.app,
  }
}

/** 无 SSE 或长时间收不到流时的 REST 轮询间隔（秒）。 */
const PLAYING_FALLBACK_POLL_SEC = 6
/** 已建立 EventSource 后若这么久仍无首条 data，则改用 REST 轮询。 */
const PLAYING_SSE_STALL_MS = 5000

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

  const selected = findDeviceByIdentifier(devices, selectedId)
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

    const applySnapshot = (s: PlayingSnapshot) => {
      if (cancelled) return
      setPlayingSnap((prev) => mergePlayingSnapshot(prev, s))
      setPlayingInitial(false)
    }

    const reconcile = async () => {
      try {
        const s = await fetchPlaying(selectedId)
        applySnapshot(s)
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

    let pollId: ReturnType<typeof window.setInterval> | undefined
    let stallTimer: ReturnType<typeof window.setTimeout> | undefined
    let sseReceived = false

    const clearPoll = () => {
      if (pollId != null) {
        window.clearInterval(pollId)
        pollId = undefined
      }
    }

    const startRestPolling = (runImmediate: boolean) => {
      if (pollId != null) return
      if (runImmediate) void reconcile()
      pollId = window.setInterval(
        () => void reconcile(),
        PLAYING_FALLBACK_POLL_SEC * 1000,
      )
    }

    let es: EventSource | null = null
    if (typeof EventSource !== "undefined") {
      try {
        es = new EventSource(playingStreamUrl(selectedId))
        es.onmessage = (ev) => {
          sseReceived = true
          if (stallTimer != null) {
            window.clearTimeout(stallTimer)
            stallTimer = undefined
          }
          clearPoll()
          try {
            const s = JSON.parse(ev.data) as PlayingSnapshot
            applySnapshot(s)
          } catch {
            /* 忽略畸形帧 */
          }
        }
        stallTimer = window.setTimeout(() => {
          stallTimer = undefined
          if (cancelled || sseReceived) return
          startRestPolling(true)
        }, PLAYING_SSE_STALL_MS)
      } catch {
        es = null
      }
    }

    if (!es) {
      startRestPolling(true)
    }

    return () => {
      cancelled = true
      if (stallTimer != null) window.clearTimeout(stallTimer)
      clearPoll()
      es?.close()
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

  const resetPairUi = useCallback(() => {
    setPairSession(null)
    setPairTvProvides(false)
    setPairEnterOnTv(null)
    setPairPinInput("")
    setPairBusy(false)
  }, [])

  const openPairDialog = useCallback(() => {
    resetPairUi()
    setPairDeviceId(selectedId || devices[0]?.identifier || "")
    setPairOpen(true)
  }, [devices, resetPairUi, selectedId])

  const closePairDialog = () => {
    if (pairSession) void pairCancel(pairSession)
    resetPairUi()
    setPairOpen(false)
  }

  const startPairWithDeviceId = useCallback(
    async (id: string) => {
      if (!id) {
        toast.error(t("pair.chooseDeviceFirst"))
        return
      }
      setPairBusy(true)
      try {
        const r = await pairBegin(id)
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
    },
    [t],
  )

  const startPair = useCallback(async () => {
    await startPairWithDeviceId(pairDeviceId)
  }, [pairDeviceId, startPairWithDeviceId])

  const openPairDialogAndStartPairing = useCallback(
    async (deviceId: string) => {
      resetPairUi()
      setPairDeviceId(deviceId)
      setSelectedId(deviceId)
      setPairOpen(true)
      await startPairWithDeviceId(deviceId)
    },
    [resetPairUi, startPairWithDeviceId],
  )

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
    openPairDialogAndStartPairing,
    closePairDialog,
    startPair,
    completePairFromTv,
  }
}
