const isProduction = process.env.NODE_ENV === "production"

export const CSRF_COOKIE_NAME = "pa.csrf"
export const CSRF_HEADER_NAME = "x-csrf-token"

export const CSRF_COOKIE_OPTIONS = {
  path: "/",
  sameSite: "strict" as const,
  httpOnly: false,
  secure: isProduction,
  maxAge: 12 * 60 * 60,
}

export function generateCsrfToken() {
  const array = new Uint8Array(32)
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(array)
  } else {
    throw new Error("Secure random generation is unavailable in this environment")
  }
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("")
}
