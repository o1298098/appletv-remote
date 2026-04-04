import { useEffect, useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import type { PlayingSnapshot } from "@/lib/api"
import { playingArtworkUrl } from "@/lib/api"
import { PLAYING_FETCH_FAILED_MARKER } from "@/lib/atv-remote-constants"
import {
  formatPlaybackTime,
  playingArtCacheKey,
  resolvePlayingSubtitle,
} from "@/lib/atv-playing-utils"
import { PlayingSeekBar } from "@/components/remote/playing-seek-bar"

export function PlayingSection({
  deviceId,
  snapshot,
  initialLoading,
  onSeek,
}: {
  deviceId: string
  snapshot: PlayingSnapshot | null
  initialLoading: boolean
  onSeek?: (positionSec: number) => void
}) {
  const { t } = useTranslation()
  const [artFailed, setArtFailed] = useState(false)

  const artKey = useMemo(
    () => (snapshot?.supported ? playingArtCacheKey(snapshot) : 0),
    [
      snapshot?.supported,
      snapshot?.title,
      snapshot?.total_time_sec,
      snapshot?.app?.identifier,
    ],
  )

  useEffect(() => {
    setArtFailed(false)
  }, [artKey, deviceId])

  const stateLabel = (raw: string | null | undefined) => {
    if (!raw) return null
    const key = `playing.state.${raw}`
    const translated = t(key)
    return translated === key ? raw : translated
  }

  if (initialLoading && !snapshot) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center gap-2.5 text-xs">
        <Loader2 className="text-muted-foreground size-3.5 shrink-0 animate-spin" />
        <span className="text-muted-foreground">{t("playing.loading")}</span>
      </div>
    )
  }

  if (!snapshot) return null

  if (!snapshot.supported) {
    const fetchFailed = snapshot.detail === PLAYING_FETCH_FAILED_MARKER
    return (
      <div className="flex h-full min-h-0 flex-col justify-center gap-2 overflow-hidden text-xs leading-snug">
        <p className="text-muted-foreground">
          {fetchFailed ? t("playing.fetchFailed") : t("playing.unavailable")}
        </p>
        {!fetchFailed && snapshot.detail ? (
          <p
            className="text-muted-foreground line-clamp-3 font-mono text-[10px] break-all opacity-80"
            title={snapshot.detail}
          >
            {snapshot.detail}
          </p>
        ) : null}
      </div>
    )
  }

  const hasMediaHints =
    (snapshot.total_time_sec != null && snapshot.total_time_sec > 0) ||
    (snapshot.position_sec != null && snapshot.position_sec > 0) ||
    (snapshot.media_type != null && snapshot.media_type !== "Unknown")

  const idleLike =
    (snapshot.device_state === "Idle" || snapshot.device_state === "Stopped") &&
    !snapshot.title?.trim() &&
    !hasMediaHints

  if (idleLike) {
    return null
  }

  const title = snapshot.title?.trim() || t("playing.unknownTitle")
  const subtitle = resolvePlayingSubtitle(snapshot)
  const pos = snapshot.position_sec
  const total = snapshot.total_time_sec
  const hasTotal = total != null && total > 0
  const hasPos = pos != null && pos >= 0
  const showTimes = hasPos || hasTotal
  /** 部分 App（如 Infuse）有进度无总时长；推断上限以便进度条仍可映射秒数并拖动 */
  const seekTotalSec =
    hasTotal && total != null
      ? total
      : hasPos && pos != null
        ? Math.max(pos + 900, Math.ceil(pos * 1.08), 120)
        : null
  const canDragSeek =
    Boolean(onSeek) &&
    Boolean(deviceId) &&
    seekTotalSec != null &&
    seekTotalSec > 0
  const barPct =
    hasTotal && hasPos
      ? Math.min(100, (pos! / total!) * 100)
      : hasTotal
        ? 0
        : seekTotalSec != null && hasPos && pos != null
          ? Math.min(100, (pos / seekTotalSec) * 100)
          : null

  const showPoster = Boolean(deviceId && !artFailed)

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-start gap-2.5">
        {showPoster ? (
          <div className="relative size-9 shrink-0 overflow-hidden rounded-md bg-background/50 ring-1 ring-black/10 dark:bg-background/20 dark:ring-white/15 sm:size-10">
            <img
              src={playingArtworkUrl(deviceId, artKey, 112)}
              alt=""
              className="m-0 block size-full object-cover"
              loading="lazy"
              decoding="async"
              onError={() => setArtFailed(true)}
            />
          </div>
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-hidden">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h3
                className="text-foreground line-clamp-2 break-words text-xs leading-snug font-medium tracking-tight"
                title={title}
              >
                {title}
              </h3>
            </div>
            {snapshot.device_state ? (
              <Badge
                variant="outline"
                className="shrink-0 border-border/60 px-1.5 py-0.5 text-[9px] font-medium leading-none"
              >
                {stateLabel(snapshot.device_state)}
              </Badge>
            ) : null}
          </div>
          {subtitle ? (
            <p className="text-muted-foreground line-clamp-1 text-[10px] leading-snug">
              {subtitle}
            </p>
          ) : null}
          {snapshot.app?.name ? (
            <p className="text-muted-foreground/80 text-[10px] leading-snug">
              {t("playing.appLabel")} · {snapshot.app.name}
            </p>
          ) : null}
        </div>
      </div>
      {showTimes ? (
        <div className="mt-1.5 shrink-0 space-y-0.5 border-t border-border/50 pt-1.5">
          {canDragSeek && onSeek ? (
            <PlayingSeekBar
              positionSec={hasPos && pos != null ? pos : 0}
              totalSec={seekTotalSec}
              disabled={!deviceId}
              onSeek={onSeek}
              ariaLabel={t("playing.seekAria")}
            />
          ) : (
            <div className="h-0.5 w-full overflow-hidden rounded-full bg-background/50 dark:bg-background/20">
              {barPct !== null ? (
                <div
                  className="bg-foreground/70 dark:bg-foreground/80 h-full rounded-full transition-[width] duration-500 ease-out"
                  style={{ width: `${barPct}%` }}
                />
              ) : (
                <div
                  className="bg-foreground/45 dark:bg-foreground/55 h-full w-1/3 max-w-[45%] animate-pulse rounded-full"
                  aria-hidden
                />
              )}
            </div>
          )}
          <div className="text-muted-foreground flex justify-between tabular-nums text-[10px] leading-none tracking-wide">
            <span>{pos != null && pos >= 0 ? formatPlaybackTime(pos) : "—"}</span>
            <span>
              {total != null && total > 0 ? formatPlaybackTime(total) : "—"}
            </span>
          </div>
        </div>
      ) : null}
      {snapshot.hint ? (
        <p
          className="text-muted-foreground mt-1.5 line-clamp-2 shrink-0 border-t border-border/50 pt-1.5 text-[10px] leading-snug"
          title={snapshot.hint}
        >
          {snapshot.hint}
        </p>
      ) : null}
    </div>
  )
}
