import { createServerClient } from "@supabase/ssr"
import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies"
import { NextResponse, type NextRequest } from "next/server"

import {
  SESSION_AAL_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
  SESSION_IDLE_COOKIE_NAME,
  SESSION_ISSUED_COOKIE_NAME,
  SESSION_MFA_REQUIRED_COOKIE_NAME,
  SESSION_ROLE_COOKIE_NAME,
  getSessionRole,
} from "@/lib/security/session"
import {
  getActiveTotpSecret,
  getPendingTotpSecret,
  readMfaState,
  updateMfaState,
  toPublicMfaState,
} from "@/lib/security/mfa-store"
import { verifyTotpToken } from "@/lib/security/totp"

type CookieMutation = {
  name: string
  value: string
  options?: ResponseCookie
}

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

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: "Authentication service unavailable" }, { status: 500 })
  }

  const payload = await request.json().catch(() => null)
  const code = payload?.code?.toString().trim()

  if (!code) {
    return NextResponse.json({ error: "Verification code is required" }, { status: 400 })
  }

  const cookieMutations: CookieMutation[] = []

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieMutations.push({ name, value, options })
        })
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { state } = await readMfaState(user.id)
  const role = getSessionRole(user)
  const pendingSecret = getPendingTotpSecret(state)
  const activeSecret = getActiveTotpSecret(state)

  const secret = pendingSecret ?? activeSecret
  if (!secret) {
    return NextResponse.json({ error: "No TOTP factor to verify" }, { status: 400 })
  }

  const isValid = verifyTotpToken(secret, code)
  if (!isValid) {
    return NextResponse.json({ error: "Invalid verification code" }, { status: 400 })
  }

  const wasEnrollment = Boolean(pendingSecret)

  const { state: nextState } = await updateMfaState(
    user.id,
    (current) => {
      const next = { ...current }
      const totp = { ...(current.totp ?? {}) }

      if (wasEnrollment && totp.pendingSecret) {
        totp.secret = totp.pendingSecret
        delete totp.pendingSecret
        totp.enrolledAt = new Date().toISOString()
      }

      totp.verified = true
      next.totp = totp

      return next
    },
    wasEnrollment
      ? (metadata) => {
          const security =
            metadata.security && typeof metadata.security === "object"
              ? (metadata.security as Record<string, unknown>)
              : {}

          const completionTimestamp =
            typeof security.firstLoginCompletedAt === "string"
              ? security.firstLoginCompletedAt
              : new Date().toISOString()

          return {
            ...metadata,
            security: {
              ...security,
              firstLoginComplete: true,
              firstLoginCompletedAt: completionTimestamp,
            },
          }
        }
      : undefined,
  )

  const { error: refreshError } = await supabase.auth.refreshSession()
  if (refreshError) {
    console.error("[mfa] failed to refresh session after totp verification", refreshError)
  }

  const nowSeconds = Math.floor(Date.now() / 1000)

  const response = NextResponse.json(
    {
      ok: true,
      wasEnrollment,
      role,
      mfa: toPublicMfaState(nextState),
    },
    { status: 200 },
  )

  response.cookies.set(SESSION_AAL_COOKIE_NAME, "aal2", SESSION_COOKIE_OPTIONS)
  response.cookies.set(SESSION_MFA_REQUIRED_COOKIE_NAME, "0", SESSION_COOKIE_OPTIONS)
  response.cookies.set(SESSION_IDLE_COOKIE_NAME, nowSeconds.toString(), SESSION_COOKIE_OPTIONS)
  response.cookies.set(SESSION_ISSUED_COOKIE_NAME, nowSeconds.toString(), SESSION_COOKIE_OPTIONS)
  response.cookies.set(SESSION_ROLE_COOKIE_NAME, role, SESSION_COOKIE_OPTIONS)

  return applyCookieMutations(response, cookieMutations)
}
