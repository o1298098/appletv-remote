const jsonHeaders = { "Content-Type": "application/json" }

async function parseError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { detail?: string | { msg: string }[] }
    if (typeof j.detail === "string") return j.detail
    if (Array.isArray(j.detail)) return j.detail.map((x) => x.msg).join("; ")
  } catch {}
  return res.statusText || `HTTP ${res.status}`
}

export type AtvDevice = {
  identifier: string
  name: string
  address: string
  ready: boolean
  mrp_credentials: boolean
  companion_credentials: boolean
  airplay_credentials: boolean
}

export async function scanDevices(): Promise<AtvDevice[]> {
  const res = await fetch("/api/scan", { method: "POST" })
  if (!res.ok) throw new Error(await parseError(res))
  const data = (await res.json()) as { devices: AtvDevice[] }
  return data.devices
}

export async function sendRemote(
  identifier: string,
  command: string,
  options?: { action?: string; position_sec?: number },
): Promise<void> {
  const res = await fetch(`/api/devices/${encodeURIComponent(identifier)}/remote`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      command,
      action: options?.action,
      position_sec: options?.position_sec,
    }),
  })
  if (!res.ok) throw new Error(await parseError(res))
}

export async function disconnectDevice(identifier: string): Promise<void> {
  const res = await fetch(
    `/api/devices/${encodeURIComponent(identifier)}/disconnect`,
    { method: "POST" },
  )
  if (!res.ok) throw new Error(await parseError(res))
}

export type PairBeginResult = {
  session_id: string
  device_provides_pin: boolean
  protocol: string
  enter_on_tv_pin: string | null
}

export async function pairBegin(identifier: string): Promise<PairBeginResult> {
  const res = await fetch("/api/pair/begin", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ identifier }),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json() as Promise<PairBeginResult>
}

export async function pairPin(sessionId: string, pin: string): Promise<void> {
  const res = await fetch("/api/pair/pin", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ session_id: sessionId, pin }),
  })
  if (!res.ok) throw new Error(await parseError(res))
}

export async function pairFinish(sessionId: string): Promise<boolean> {
  const res = await fetch("/api/pair/finish", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ session_id: sessionId }),
  })
  if (!res.ok) throw new Error(await parseError(res))
  const j = (await res.json()) as { paired: boolean }
  return j.paired
}

export async function pairCancel(sessionId: string): Promise<void> {
  await fetch("/api/pair/cancel", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ session_id: sessionId }),
  })
}

export async function healthCheck(): Promise<boolean> {
  try {
    const res = await fetch("/api/health")
    return res.ok
  } catch {
    return false
  }
}

export type PlayingAppInfo = {
  name: string | null
  identifier: string
}

export type PlayingSnapshot = {
  supported: boolean
  detail?: string | null
  app?: PlayingAppInfo | null
  media_type?: string | null
  device_state?: string | null
  title?: string | null
  artist?: string | null
  album?: string | null
  genre?: string | null
  series_name?: string | null
  season_number?: number | null
  episode_number?: number | null
  position_sec?: number | null
  total_time_sec?: number | null
  hint?: string | null
}

export async function fetchPlaying(identifier: string): Promise<PlayingSnapshot> {
  const res = await fetch(
    `/api/devices/${encodeURIComponent(identifier)}/playing`,
  )
  if (!res.ok) throw new Error(await parseError(res))
  return res.json() as Promise<PlayingSnapshot>
}

/** pyatv 推送经后端的 SSE；与 `fetchPlaying` 同域。 */
export function playingStreamUrl(identifier: string): string {
  return `/api/devices/${encodeURIComponent(identifier)}/playing/stream`
}

export type AtvInstalledApp = {
  name: string | null
  identifier: string
  /** 来自 pyatv（若将来支持）或后端 iTunes 查询的 HTTPS 图标地址 */
  icon_url?: string | null
}

export async function fetchInstalledApps(
  identifier: string,
): Promise<AtvInstalledApp[]> {
  const res = await fetch(
    `/api/devices/${encodeURIComponent(identifier)}/apps`,
  )
  if (!res.ok) throw new Error(await parseError(res))
  const data = (await res.json()) as { apps: AtvInstalledApp[] }
  return data.apps
}

/** `target` 为 bundle id（如 com.netflix.Netflix）或 pyatv 支持的深链 URL。 */
export async function launchAtvApp(
  identifier: string,
  target: string,
): Promise<void> {
  const res = await fetch(
    `/api/devices/${encodeURIComponent(identifier)}/apps/launch`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ target }),
    },
  )
  if (!res.ok) throw new Error(await parseError(res))
}

export function playingArtworkUrl(
  identifier: string,
  cacheKey: number,
  widthPx = 480,
): string {
  return `/api/devices/${encodeURIComponent(identifier)}/playing/artwork?w=${widthPx}&v=${cacheKey}`
}
