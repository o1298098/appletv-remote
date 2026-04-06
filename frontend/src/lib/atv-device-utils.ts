import type { AtvDevice } from "@/lib/api"
import { STORAGE_KEY } from "@/lib/atv-remote-constants"

/** 12 hex digits for MAC-like ids (colons / hyphens optional). */
function macCompactKey(s: string): string | null {
  const compact = s.replace(/[:-]/g, "").toLowerCase()
  if (compact.length !== 12 || !/^[0-9a-f]{12}$/.test(compact)) return null
  return compact
}

/** True when two pyatv identifiers refer to the same device (e.g. MAC formatting differs). */
export function identifiersEqual(a: string, b: string): boolean {
  if (a === b) return true
  const ka = macCompactKey(a)
  const kb = macCompactKey(b)
  if (ka && kb) return ka === kb
  return false
}

export function findDeviceByIdentifier(
  list: AtvDevice[],
  id: string,
): AtvDevice | undefined {
  if (!id) return undefined
  return list.find((d) => identifiersEqual(d.identifier, id))
}

export function resolveSelectedAfterScan(
  list: AtvDevice[],
  currentSelected: string,
): string {
  if (list.length === 0) return currentSelected

  const canonical = (id: string) =>
    id ? findDeviceByIdentifier(list, id)?.identifier ?? "" : ""

  if (currentSelected) {
    const c = canonical(currentSelected)
    if (c) return c
  }
  const stored = localStorage.getItem(STORAGE_KEY) ?? ""
  const fromStored = canonical(stored)
  if (fromStored) return fromStored
  const firstPaired = list.find(
    (d) => d.mrp_credentials || d.companion_credentials,
  )
  if (firstPaired) return firstPaired.identifier
  return list[0].identifier
}
