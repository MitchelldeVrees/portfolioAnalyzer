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
  SessionAssuranceLevel,
  getSessionRole,
} from "@/lib/security/session"
import {
  hasTotpFactor,
  hasWebAuthnFactor,
  readMfaState,
  toPublicMfaState,
} from "@/lib/security/mfa-store"

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
    return NextResponse.json({ error: "Authentication service is unavailable" }, { status: 500 })
  }

  const payload = await request.json().catch(() => null)
  const email = payload?.email?.toString().trim()?.toLowerCase()
  const password = payload?.password?.toString() ?? ""

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 })
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

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data?.user) {
    const status = error?.status === 400 ? 401 : 400
    return NextResponse.json({ error: "Invalid credentials" }, { status })
  }

  const { user } = data
  const { state } = await readMfaState(user.id)

  const userRole = getSessionRole(user)
  const hasTotp = hasTotpFactor(state)
  const hasWebAuthn = hasWebAuthnFactor(state)
  const securityMetadata = (user.app_metadata?.security ?? null) as { firstLoginComplete?: boolean } | null
  const firstLoginComplete = Boolean(securityMetadata?.firstLoginComplete)

  const requiresMfa = userRole === "admin" || hasTotp || hasWebAuthn
  const needsEnrollment = userRole === "admin" && !hasTotp && !hasWebAuthn
  const requiresFirstLoginSetup = !firstLoginComplete && !hasTotp && !hasWebAuthn

  const nowSeconds = Math.floor(Date.now() / 1000)
  const assuranceLevel: SessionAssuranceLevel = requiresMfa ? "aal1" : "aal2"
  const mfaRequiredFlag = requiresMfa ? "1" : "0"

  const response = NextResponse.json(
    {
      ok: true,
      requiresMfa,
      needsEnrollment,
      requiresFirstLoginSetup,
      mfa: toPublicMfaState(state),
    },
    { status: 200 },
  )

  response.cookies.set(SESSION_AAL_COOKIE_NAME, assuranceLevel, SESSION_COOKIE_OPTIONS)
  response.cookies.set(SESSION_MFA_REQUIRED_COOKIE_NAME, mfaRequiredFlag, SESSION_COOKIE_OPTIONS)
  response.cookies.set(SESSION_IDLE_COOKIE_NAME, nowSeconds.toString(), SESSION_COOKIE_OPTIONS)
  response.cookies.set(SESSION_ISSUED_COOKIE_NAME, nowSeconds.toString(), SESSION_COOKIE_OPTIONS)
  response.cookies.set(SESSION_ROLE_COOKIE_NAME, userRole, SESSION_COOKIE_OPTIONS)

  return applyCookieMutations(response, cookieMutations)
}
