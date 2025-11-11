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
} from "@/lib/security/session"

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

function clearSessionCookies(response: NextResponse) {
  const names = [
    SESSION_ROLE_COOKIE_NAME,
    SESSION_AAL_COOKIE_NAME,
    SESSION_MFA_REQUIRED_COOKIE_NAME,
    SESSION_IDLE_COOKIE_NAME,
    SESSION_ISSUED_COOKIE_NAME,
  ]
  for (const name of names) {
    response.cookies.set(name, "", { ...SESSION_COOKIE_OPTIONS, maxAge: 0 })
  }
  return response
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: "Authentication service is unavailable" }, { status: 500 })
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

  const { error } = await supabase.auth.signOut()
  if (error) {
    console.error("[auth] signOut failed", error)
  }

  const response = clearSessionCookies(NextResponse.json({ ok: true }, { status: 200 }))
  return applyCookieMutations(response, cookieMutations)
}
