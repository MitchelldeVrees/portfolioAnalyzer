import { createServerClient } from "@supabase/ssr"
import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies"
import { NextResponse, type NextRequest } from "next/server"

import {
  SESSION_AAL_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
  SESSION_MFA_REQUIRED_COOKIE_NAME,
  getSessionRole,
} from "@/lib/security/session"
import {
  getActiveTotpSecret,
  hasWebAuthnFactor,
  readMfaState,
  toPublicMfaState,
  updateMfaState,
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
    return NextResponse.json({ error: "Verification code is required to disable TOTP" }, { status: 400 })
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
  const activeSecret = getActiveTotpSecret(state)
  if (!activeSecret) {
    return NextResponse.json({ error: "No active TOTP factor to disable" }, { status: 400 })
  }

  const role = getSessionRole(user)
  if (role === "admin" && !hasWebAuthnFactor(state)) {
    return NextResponse.json({ error: "Administrators must retain at least one MFA factor" }, { status: 403 })
  }

  if (!verifyTotpToken(activeSecret, code)) {
    return NextResponse.json({ error: "Invalid verification code" }, { status: 400 })
  }

  const { state: nextState } = await updateMfaState(user.id, (current) => {
    const next = { ...current }
    delete next.totp
    return next
  })

  const response = NextResponse.json({ ok: true, mfa: toPublicMfaState(nextState) }, { status: 200 })

  response.cookies.set(SESSION_AAL_COOKIE_NAME, "aal2", SESSION_COOKIE_OPTIONS)
  response.cookies.set(SESSION_MFA_REQUIRED_COOKIE_NAME, "0", SESSION_COOKIE_OPTIONS)

  return applyCookieMutations(response, cookieMutations)
}
