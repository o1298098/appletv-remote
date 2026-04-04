import type { AtvDevice } from "@/lib/api"
import { STORAGE_KEY } from "@/lib/atv-remote-constants"

export function resolveSelectedAfterScan(
  list: AtvDevice[],
  currentSelected: string,
): string {
  if (list.length === 0) return currentSelected
  if (currentSelected && list.some((d) => d.identifier === currentSelected)) {
    return currentSelected
  }
  const stored = localStorage.getItem(STORAGE_KEY) ?? ""
  const matchStored = stored ? list.find((d) => d.identifier === stored) : undefined
  if (matchStored) return matchStored.identifier
  const firstPaired = list.find(
    (d) => d.mrp_credentials || d.companion_credentials,
  )
  if (firstPaired) return firstPaired.identifier
  return list[0].identifier
}
