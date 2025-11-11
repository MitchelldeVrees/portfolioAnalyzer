import { createServerClient } from "@supabase/ssr"
import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies"
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { SESSION_COOKIE_OPTIONS } from "@/lib/security/session"

type CookieMutation = {
  name: string
  value: string
  options?: ResponseCookie
}

export const holdingSchema = z.object({
  ticker: z.string().min(1),
  weight: z.number().finite().optional(),
  shares: z.number().finite().nullable().optional(),
  purchasePrice: z.number().finite().nullable().optional(),
})

const createPortfolioSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  holdings: z.array(holdingSchema).optional().default([]),
})

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

export function mapHolding(portfolioId: string, holding: z.infer<typeof holdingSchema>) {
  return {
    portfolio_id: portfolioId,
    ticker: holding.ticker,
    weight: holding.weight ?? 0,
    shares: holding.shares ?? null,
    purchase_price: holding.purchasePrice ?? null,
  }
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: "Portfolio service unavailable" }, { status: 500 })
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

  let parsedBody: z.infer<typeof createPortfolioSchema>
  try {
    const body = await request.json()
    parsedBody = createPortfolioSchema.parse(body)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request payload"
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const { data: portfolio, error: insertError } = await supabase
      .from("portfolios")
      .insert({
        user_id: user.id,
        name: parsedBody.name.trim(),
        description: parsedBody.description?.trim() || null,
      })
      .select()
      .single()

    if (insertError) throw insertError
    if (!portfolio) throw new Error("Portfolio creation failed")

    if (parsedBody.holdings.length > 0) {
      const holdingsPayload = parsedBody.holdings.map((holding) => mapHolding(portfolio.id, holding))
      const { error: holdingsError } = await supabase.from("portfolio_holdings").insert(holdingsPayload)
      if (holdingsError) throw holdingsError
    }

    const response = NextResponse.json({ ok: true, portfolioId: portfolio.id }, { status: 201 })
    return applyCookieMutations(response, cookieMutations)
  } catch (error) {
    console.error("[portfolio] create failed", error)
    const message = error instanceof Error ? error.message : "Failed to create portfolio"
    return applyCookieMutations(NextResponse.json({ error: message }, { status: 400 }), cookieMutations)
  }
}
