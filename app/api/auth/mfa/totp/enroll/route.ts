import { createServerClient } from "@supabase/ssr"
import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies"
import { NextResponse, type NextRequest } from "next/server"

import { SESSION_AAL_COOKIE_NAME, SESSION_COOKIE_OPTIONS, SESSION_MFA_REQUIRED_COOKIE_NAME } from "@/lib/security/session"
import { generateTotpSecret, buildTotpKeyUri } from "@/lib/security/totp"
import { storeTotpSecret, updateMfaState } from "@/lib/security/mfa-store"

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

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const secret = generateTotpSecret()
  const encrypted = storeTotpSecret(secret)

  await updateMfaState(user.id, (current) => {
    return {
      ...current,
      totp: {
        ...(current.totp ?? {}),
        pendingSecret: encrypted,
        verified: false,
      },
    }
  })

  const otpauthUrl = buildTotpKeyUri(user.email ?? "user", secret)
  const response = NextResponse.json(
    {
      ok: true,
      secret,
      otpauthUrl,
      issuer: process.env.MFA_TOTP_ISSUER ?? "Portfolio Analyzer",
    },
    { status: 200 },
  )

  response.cookies.set(SESSION_AAL_COOKIE_NAME, "aal1", SESSION_COOKIE_OPTIONS)
  response.cookies.set(SESSION_MFA_REQUIRED_COOKIE_NAME, "1", SESSION_COOKIE_OPTIONS)

  return applyCookieMutations(response, cookieMutations)
}
