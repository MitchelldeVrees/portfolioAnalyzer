import { createServerClient } from "@supabase/ssr"
import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies"
import { NextResponse, type NextRequest } from "next/server"

import { deleteAllUserPortfolioData } from "@/lib/account/user-data"
import { SESSION_COOKIE_OPTIONS, SESSION_IDLE_COOKIE_NAME, SESSION_ISSUED_COOKIE_NAME, SESSION_ROLE_COOKIE_NAME } from "@/lib/security/session"
import { createAdminClient } from "@/lib/supabase/admin"

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
  const names = [SESSION_ROLE_COOKIE_NAME, SESSION_IDLE_COOKIE_NAME, SESSION_ISSUED_COOKIE_NAME]
  for (const name of names) {
    response.cookies.set(name, "", { ...SESSION_COOKIE_OPTIONS, maxAge: 0 })
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

  try {
    await deleteAllUserPortfolioData(supabase, user.id)
  } catch (error) {
    console.error("[account] failed to purge data before account deletion", error)
  }

  try {
    const admin = createAdminClient()
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
    if (deleteError) {
      return NextResponse.json({ error: deleteError.message || "Unable to delete account" }, { status: 400 })
    }
  } catch (error) {
    console.error("[account] administrator delete failed", error)
    return NextResponse.json({ error: "Unable to delete account" }, { status: 500 })
  }

  const { error: signOutError } = await supabase.auth.signOut()
  if (signOutError) {
    console.error("[account] sign out after delete failed", signOutError)
  }

  const response = clearSessionCookies(NextResponse.json({ ok: true }, { status: 200 }))
  return applyCookieMutations(response, cookieMutations)
}
