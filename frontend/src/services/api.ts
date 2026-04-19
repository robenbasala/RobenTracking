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
