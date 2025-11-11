import { createServerClient } from "@supabase/ssr"
import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies"
import { NextResponse, type NextRequest } from "next/server"

import { SESSION_COOKIE_OPTIONS } from "@/lib/security/session"

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

function toSafeFileName(name: string, id: string) {
  const clean = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  const base = clean || "portfolio"
  return `${base}-${id}.json`
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
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

  const portfolioId = params?.id
  if (!portfolioId) {
    return NextResponse.json({ error: "Portfolio id is required" }, { status: 400 })
  }

  const { data: portfolio, error } = await supabase
    .from("portfolios")
    .select("*, portfolio_holdings (*)")
    .eq("id", portfolioId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (error || !portfolio) {
    return NextResponse.json({ error: "Portfolio not found" }, { status: 404 })
  }

  const body = JSON.stringify(portfolio, null, 2)
  const filename = toSafeFileName(portfolio.name ?? "portfolio", portfolio.id)
  const response = new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Download-Filename": filename,
    },
  })

  return applyCookieMutations(response, cookieMutations)
}
