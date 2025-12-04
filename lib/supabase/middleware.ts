import { createServerClient } from "@supabase/ssr"
import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies"
import { NextResponse, type NextRequest } from "next/server"

import {
  SESSION_ABSOLUTE_TIMEOUT_SECONDS,
  SESSION_COOKIE_OPTIONS,
  SESSION_IDLE_COOKIE_NAME,
  SESSION_IDLE_TIMEOUT_SECONDS,
  SESSION_ISSUED_COOKIE_NAME,
  SESSION_ROLE_COOKIE_NAME,
  getSessionRole,
} from "@/lib/security/session"
import { CSRF_COOKIE_NAME, CSRF_COOKIE_OPTIONS, CSRF_HEADER_NAME, generateCsrfToken } from "@/lib/security/csrf"

type CookieMutation = {
  name: string
  value: string
  options?: ResponseCookie
}

const PUBLIC_PATHS = ["/", "/auth/login", "/auth/signup", "/auth/verify-email"]

function applyCookieMutations(response: NextResponse, mutations: CookieMutation[]) {
  for (const { name, value, options } of mutations) {
    const mergedOptions = { ...SESSION_COOKIE_OPTIONS, ...options }

    if (options?.maxAge === 0 || value === "") {
      response.cookies.set(name, "", { ...mergedOptions, maxAge: 0 })
    } else {
      response.cookies.set(name, value, mergedOptions)
    }
  }

  return response
}

function clearSecurityCookies(response: NextResponse) {
  const names = [SESSION_IDLE_COOKIE_NAME, SESSION_ISSUED_COOKIE_NAME, SESSION_ROLE_COOKIE_NAME]
  for (const name of names) {
    response.cookies.set(name, "", { ...SESSION_COOKIE_OPTIONS, maxAge: 0 })
  }
  return response
}

function shouldRedirectToLogin(request: NextRequest) {
  if (request.method === "OPTIONS") return false
  const path = request.nextUrl.pathname
  if (PUBLIC_PATHS.includes(path)) return false
  if (path.startsWith("/auth") || path.startsWith("/api/auth")) return false
  return true
}

export async function updateSession(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  const initialResponse = NextResponse.next({ request })

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("[security] Missing Supabase environment variables in middleware")
    return setCsrfCookie(initialResponse)
  }

  const cookieMutations: CookieMutation[] = []

  const method = request.method.toUpperCase()
  const isSafeMethod = method === "GET" || method === "HEAD" || method === "OPTIONS"
  let csrfToken = request.cookies.get(CSRF_COOKIE_NAME)?.value ?? null
  let csrfNeedsSet = false

  if (!csrfToken) {
    csrfToken = generateCsrfToken()
    csrfNeedsSet = true
  }

  if (!isSafeMethod) {
    const headerToken = request.headers.get(CSRF_HEADER_NAME)
    if (!headerToken || headerToken !== csrfToken) {
      const forbidden = NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 })
      forbidden.cookies.set(CSRF_COOKIE_NAME, csrfToken, CSRF_COOKIE_OPTIONS)
      return forbidden
    }
  }

  const setCsrfCookie = (response: NextResponse) => {
    response.cookies.set(CSRF_COOKIE_NAME, csrfToken!, CSRF_COOKIE_OPTIONS)
    return response
  }

  try {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookieOptions: SESSION_COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value)
            cookieMutations.push({ name, value, options })
          })
        },
      },
    })

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error) {
      console.error("[security] Supabase auth error:", error)
      return setCsrfCookie(applyCookieMutations(initialResponse, cookieMutations))
    }

    if (!user) {
      const response = applyCookieMutations(clearSecurityCookies(initialResponse), cookieMutations)

      if (shouldRedirectToLogin(request)) {
        const url = request.nextUrl.clone()
        url.pathname = "/auth/login"
        return setCsrfCookie(applyCookieMutations(clearSecurityCookies(NextResponse.redirect(url)), cookieMutations))
      }

      return setCsrfCookie(response)
    }

    const nowSeconds = Math.floor(Date.now() / 1000)
    const issuedRaw = request.cookies.get(SESSION_ISSUED_COOKIE_NAME)?.value
    const lastActiveRaw = request.cookies.get(SESSION_IDLE_COOKIE_NAME)?.value
    const storedRole = request.cookies.get(SESSION_ROLE_COOKIE_NAME)?.value ?? null

    const issuedAt = issuedRaw ? Number(issuedRaw) : null
    const lastActiveAt = lastActiveRaw ? Number(lastActiveRaw) : null

    const idleLimitExceeded =
      typeof lastActiveAt === "number" && nowSeconds - lastActiveAt > SESSION_IDLE_TIMEOUT_SECONDS
    const absoluteLimitExceeded =
      typeof issuedAt === "number" && nowSeconds - issuedAt > SESSION_ABSOLUTE_TIMEOUT_SECONDS

    if (idleLimitExceeded || absoluteLimitExceeded) {
      await supabase.auth.signOut()
      const url = request.nextUrl.clone()
      url.pathname = "/auth/login"
      return setCsrfCookie(applyCookieMutations(clearSecurityCookies(NextResponse.redirect(url)), cookieMutations))
    }

    const currentRole = getSessionRole(user)
    let sessionRotated = false

    if (storedRole && storedRole !== currentRole) {
      const { error: refreshError } = await supabase.auth.refreshSession()
      if (refreshError) {
        console.error("[security] Failed to refresh session after role change", refreshError)
      } else {
        sessionRotated = true
      }
    } else if (!storedRole) {
      const { error: refreshError } = await supabase.auth.refreshSession()
      if (refreshError) {
        console.error("[security] Failed to refresh session on login", refreshError)
      } else {
        sessionRotated = true
      }
    }

    const issuedTimestamp = sessionRotated || !issuedAt ? nowSeconds : issuedAt ?? nowSeconds
    const response = NextResponse.next({ request })
    response.cookies.set(SESSION_ISSUED_COOKIE_NAME, issuedTimestamp.toString(), SESSION_COOKIE_OPTIONS)
    response.cookies.set(SESSION_IDLE_COOKIE_NAME, nowSeconds.toString(), SESSION_COOKIE_OPTIONS)
    response.cookies.set(SESSION_ROLE_COOKIE_NAME, currentRole, SESSION_COOKIE_OPTIONS)
    return setCsrfCookie(applyCookieMutations(response, cookieMutations))
  } catch (error) {
    console.error("[security] Middleware error:", error)
    return setCsrfCookie(applyCookieMutations(initialResponse, cookieMutations))
  }
}
