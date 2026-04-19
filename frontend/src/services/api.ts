/**
 * All HTTP calls to the Express backend. Base URL from NEXT_PUBLIC_API_BASE_URL
 * (default http://localhost:3001 for local dev).
 */

function getApiBase(): string {
  const raw =
    (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_BASE_URL) ||
    "http://localhost:3001"
  return raw.replace(/\/$/, "")
}

/** Full URL for opening in a new tab or passing to fetch from the browser. */
export function apiUrl(pathAndQuery: string): string {
  const p = pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`
  return `${getApiBase()}${p}`
}

/** Parse filename from Content-Disposition (attachment; filename="…"). */
function filenameFromContentDisposition(cd: string | null): string | null {
  if (!cd) return null
  const star = /filename\*\s*=\s*UTF-8''([^;\s]+)/i.exec(cd)
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].replace(/["']/g, ""))
    } catch {
      return star[1].replace(/["']/g, "")
    }
  }
  const quoted = /filename\s*=\s*"([^"]+)"/i.exec(cd)
  if (quoted?.[1]) return quoted[1].trim()
  const plain = /filename\s*=\s*([^;\s]+)/i.exec(cd)
  if (plain?.[1]) return plain[1].replace(/["']/g, "").trim()
  return null
}

/**
 * GET a binary export (Excel, PDF) and trigger a file download in the browser.
 * Surfaces JSON `{ error }` from failed responses as thrown Error.
 */
export async function downloadExportFile(
  pathAndQuery: string,
  fallbackFilename: string
): Promise<void> {
  const res = await fetch(apiUrl(pathAndQuery), { method: "GET", cache: "no-store" })
  const cd = res.headers.get("Content-Disposition")
  const safeFallback = fallbackFilename.replace(/[/\\?*:|"<>]/g, "_")
  let filename =
    filenameFromContentDisposition(cd) ?? safeFallback
  filename = filename.replace(/[/\\?*:|"<>]/g, "_").slice(0, 200)

  if (!res.ok) {
    const errText = await res.text()
    let msg = `Export failed (${res.status})`
    try {
      const j = JSON.parse(errText) as { error?: string }
      if (j.error) msg = j.error
    } catch {
      if (errText.trim()) msg = errText.trim().slice(0, 300)
    }
    throw new Error(msg)
  }

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename || safeFallback
  a.rel = "noopener"
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

type FetchInit = RequestInit & { cache?: RequestCache }

export async function apiGet(pathAndQuery: string, init?: FetchInit) {
  return fetch(apiUrl(pathAndQuery), { ...init, method: "GET" })
}

export async function apiPost(
  pathAndQuery: string,
  body?: unknown,
  init?: Omit<FetchInit, "body" | "method">
) {
  return fetch(apiUrl(pathAndQuery), {
    ...init,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string>),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

export async function apiPut(
  pathAndQuery: string,
  body?: unknown,
  init?: Omit<FetchInit, "body" | "method">
) {
  return fetch(apiUrl(pathAndQuery), {
    ...init,
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string>),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

export async function apiPatch(
  pathAndQuery: string,
  body?: unknown,
  init?: Omit<FetchInit, "body" | "method">
) {
  return fetch(apiUrl(pathAndQuery), {
    ...init,
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string>),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

export async function apiDelete(pathAndQuery: string, init?: FetchInit) {
  return fetch(apiUrl(pathAndQuery), { ...init, method: "DELETE" })
}
