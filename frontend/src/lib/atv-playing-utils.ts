import type { PlayingSnapshot } from "@/lib/api"

export function formatPlaybackTime(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) return "0:00"
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = Math.floor(totalSec % 60)
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
  }
  return `${m}:${String(s).padStart(2, "0")}`
}

export function resolvePlayingSubtitle(s: PlayingSnapshot): string | null {
  const {
    series_name,
    season_number,
    episode_number,
    artist,
    album,
    genre,
  } = s
  if (series_name) {
    const sn =
      season_number != null && episode_number != null
        ? `S${season_number}E${episode_number}`
        : season_number != null
          ? `S${season_number}`
          : episode_number != null
            ? `E${episode_number}`
            : null
    return sn ? `${series_name} · ${sn}` : series_name
  }
  if (artist) return artist
  if (album) return album
  if (genre) return genre
  return null
}

export function playingArtCacheKey(s: PlayingSnapshot): number {
  const title = s.title ?? ""
  const app = s.app?.identifier ?? ""
  const tot = s.total_time_sec ?? 0
  let h = 0
  for (let i = 0; i < title.length; i++) {
    h = (h << 5) - h + title.charCodeAt(i)
    h |= 0
  }
  return (h >>> 0) ^ (Math.imul(tot, 2654435761) >>> 0) ^ (app.length * 131)
}
