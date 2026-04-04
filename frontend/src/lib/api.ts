const jsonHeaders = { "Content-Type": "application/json" }

async function parseError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { detail?: string | { msg: string }[] }
    if (typeof j.detail === "string") return j.detail
    if (Array.isArray(j.detail)) return j.detail.map((x) => x.msg).join("; ")
  } catch {
    /* ignore */
  }
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
  options?: { action?: string },
): Promise<void> {
  const res = await fetch(`/api/devices/${encodeURIComponent(identifier)}/remote`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      command,
      action: options?.action,
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
