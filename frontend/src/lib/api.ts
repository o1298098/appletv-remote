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

export type AtvDeviceInfo = {
  operating_system: string
  version: string | null
  build_number: string | null
  model: string
  model_str: string
  raw_model: string | null
  mac: string | null
  output_device_id: string | null
}

export async function fetchDeviceInfo(
  identifier: string,
): Promise<AtvDeviceInfo> {
  const res = await fetch(
    `/api/devices/${encodeURIComponent(identifier)}/device-info`,
  )
  if (!res.ok) throw new Error(await parseError(res))
  return res.json() as Promise<AtvDeviceInfo>
}

export type AtvFeatureRow = {
  name: string
  state: string
  options: Record<string, unknown>
}

export async function fetchDeviceFeatures(
  identifier: string,
  opts?: { includeUnsupported?: boolean },
): Promise<AtvFeatureRow[]> {
  const q =
    opts?.includeUnsupported === true ? "?include_unsupported=true" : ""
  const res = await fetch(
    `/api/devices/${encodeURIComponent(identifier)}/features${q}`,
  )
  if (!res.ok) throw new Error(await parseError(res))
  const data = (await res.json()) as { features: AtvFeatureRow[] }
  return data.features
}

export type AtvKeyboardState = {
  text_focus_state: string
  text: string | null
}

export async function fetchKeyboardState(
  identifier: string,
): Promise<AtvKeyboardState> {
  const res = await fetch(
    `/api/devices/${encodeURIComponent(identifier)}/keyboard`,
  )
  if (!res.ok) throw new Error(await parseError(res))
  return res.json() as Promise<AtvKeyboardState>
}

/** 键盘焦点与文本（与 GET /keyboard 同形）；用于 SSE 自动弹出输入框。 */
export function keyboardStreamUrl(identifier: string): string {
  return `/api/devices/${encodeURIComponent(identifier)}/keyboard/stream`
}

export async function keyboardRemoteOp(
  identifier: string,
  body: { op: "clear" | "append" | "set"; text?: string | null },
): Promise<AtvKeyboardState> {
  const res = await fetch(
    `/api/devices/${encodeURIComponent(identifier)}/keyboard`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) throw new Error(await parseError(res))
  return res.json() as Promise<AtvKeyboardState>
}

export async function touchSwipeRemote(
  identifier: string,
  body: {
    start_x: number
    start_y: number
    end_x: number
    end_y: number
    duration_ms: number
  },
): Promise<void> {
  const res = await fetch(
    `/api/devices/${encodeURIComponent(identifier)}/touch/swipe`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) throw new Error(await parseError(res))
}

export async function touchActionRemote(
  identifier: string,
  body: { x: number; y: number; mode: number },
): Promise<void> {
  const res = await fetch(
    `/api/devices/${encodeURIComponent(identifier)}/touch/action`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) throw new Error(await parseError(res))
}

export async function touchClickRemote(
  identifier: string,
  body: { action: "single" | "double" | "hold" },
): Promise<void> {
  const res = await fetch(
    `/api/devices/${encodeURIComponent(identifier)}/touch/click`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) throw new Error(await parseError(res))
}

export function touchWsUrl(identifier: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${proto}//${window.location.host}/api/devices/${encodeURIComponent(identifier)}/touch/ws`
}

export type AtvUserAccount = {
  name: string | null
  identifier: string
}

export async function fetchUserAccounts(
  identifier: string,
): Promise<AtvUserAccount[]> {
  const res = await fetch(
    `/api/devices/${encodeURIComponent(identifier)}/accounts`,
  )
  if (!res.ok) throw new Error(await parseError(res))
  const data = (await res.json()) as { accounts: AtvUserAccount[] }
  return data.accounts
}

export async function switchUserAccount(
  identifier: string,
  accountId: string,
): Promise<void> {
  const res = await fetch(
    `/api/devices/${encodeURIComponent(identifier)}/accounts/switch`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ account_id: accountId }),
    },
  )
  if (!res.ok) throw new Error(await parseError(res))
}
