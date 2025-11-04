import { createServerClient } from "@supabase/ssr"
import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies"
import { NextResponse, type NextRequest } from "next/server"

import {
  SESSION_COOKIE_OPTIONS,
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

export async function GET(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: "Authentication service unavailable" }, { status: 500 })
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
  const userRole = getSessionRole(user)
  const hasTotp = hasTotpFactor(state)
  const hasWebAuthn = hasWebAuthnFactor(state)

  const response = NextResponse.json(
    {
      ok: true,
      mfa: toPublicMfaState(state),
      requiresEnrollment: userRole === "admin" && !hasTotp && !hasWebAuthn,
      requiresMfa: userRole === "admin" || hasTotp || hasWebAuthn,
    },
    { status: 200 },
  )

  return applyCookieMutations(response, cookieMutations)
}
