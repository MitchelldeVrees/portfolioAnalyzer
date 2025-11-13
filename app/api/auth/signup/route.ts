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
import { isMfaEnabledForRole } from "@/lib/security/mfa-config"

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
  const email = payload?.email?.toString().trim().toLowerCase()
  const password = payload?.password?.toString()
  const fullName = payload?.fullName?.toString().trim()

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
        cookiesToSet.forEach(({ name, value, options }) => cookieMutations.push({ name, value, options }))
      },
    },
  })

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: fullName ? { full_name: fullName } : undefined,
    },
  })

  if (error) {
    const message = error.message || "Unable to create account"
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const user = data.user

  const nowSeconds = Math.floor(Date.now() / 1000)
  const role = getSessionRole(user)
  const requiresMfa = isMfaEnabledForRole(role)
  const requiresFirstLoginSetup = Boolean(data.session)
  const assuranceLevel: SessionAssuranceLevel = requiresMfa ? "aal1" : "aal2"
  const mfaFlag = requiresMfa ? "1" : "0"

  const response = NextResponse.json(
    {
      ok: true,
      requiresEmailConfirmation: !data.session,
      requiresMfa,
      requiresFirstLoginSetup,
      user: user ? { id: user.id, email: user.email } : null,
    },
    { status: 201 },
  )

  response.cookies.set(SESSION_AAL_COOKIE_NAME, assuranceLevel, SESSION_COOKIE_OPTIONS)
  response.cookies.set(SESSION_MFA_REQUIRED_COOKIE_NAME, mfaFlag, SESSION_COOKIE_OPTIONS)
  response.cookies.set(SESSION_IDLE_COOKIE_NAME, nowSeconds.toString(), SESSION_COOKIE_OPTIONS)
  response.cookies.set(SESSION_ISSUED_COOKIE_NAME, nowSeconds.toString(), SESSION_COOKIE_OPTIONS)
  response.cookies.set(SESSION_ROLE_COOKIE_NAME, role, SESSION_COOKIE_OPTIONS)

  return applyCookieMutations(response, cookieMutations)
}
