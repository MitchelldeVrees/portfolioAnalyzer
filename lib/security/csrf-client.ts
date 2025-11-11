import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "./csrf"

function readCookie(name: string) {
  if (typeof document === "undefined") return ""
  const pattern = new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}=([^;]*)`)
  const match = document.cookie.match(pattern)
  return match ? decodeURIComponent(match[1]) : ""
}

export function getCsrfToken() {
  return readCookie(CSRF_COOKIE_NAME)
}

export function withCsrfHeaders(init: RequestInit = {}) {
  const token = getCsrfToken()
  return {
    ...init,
    headers: {
      ...(init.headers || {}),
      [CSRF_HEADER_NAME]: token,
    },
  }
}
