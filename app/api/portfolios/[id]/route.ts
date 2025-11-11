import { createServerClient } from "@supabase/ssr"
import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies"
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { SESSION_COOKIE_OPTIONS } from "@/lib/security/session"
import { holdingSchema, mapHolding } from "../route"

type CookieMutation = {
  name: string
  value: string
  options?: ResponseCookie
}

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  holdings: z.array(holdingSchema).optional(),
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

async function resolveUserPortfolio(
  supabase: ReturnType<typeof createServerClient>,
  portfolioId: string,
  userId: string,
) {
  const { data, error } = await supabase
    .from("portfolios")
    .select("id, user_id")
    .eq("id", portfolioId)
    .maybeSingle()

  if (error) {
    throw error
  }

  if (!data) {
    return null
  }

  if (data.user_id !== userId) {
    throw new Error("Forbidden")
  }

  return data
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const portfolioId = params.id

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

  let payload: z.infer<typeof updateSchema>
  try {
    payload = updateSchema.parse(await request.json())
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
    const existing = await resolveUserPortfolio(supabase, portfolioId, user.id)
    if (!existing) {
      return NextResponse.json({ error: "Portfolio not found" }, { status: 404 })
    }

    if (payload.name || payload.description !== undefined) {
      const { error: updateError } = await supabase
        .from("portfolios")
        .update({
          name: payload.name?.trim(),
          description: payload.description?.trim() ?? null,
        })
        .eq("id", portfolioId)
        .eq("user_id", user.id)

      if (updateError) throw updateError
    }

    if (payload.holdings) {
      const { error: deleteError } = await supabase.from("portfolio_holdings").delete().eq("portfolio_id", portfolioId)
      if (deleteError) throw deleteError

      if (payload.holdings.length > 0) {
        const holdingsPayload = payload.holdings.map((holding) => mapHolding(portfolioId, holding))
        const { error: insertError } = await supabase.from("portfolio_holdings").insert(holdingsPayload)
        if (insertError) throw insertError
      }
    }

    const response = NextResponse.json({ ok: true }, { status: 200 })
    return applyCookieMutations(response, cookieMutations)
  } catch (error) {
    if (error instanceof Error && error.message === "Forbidden") {
      return applyCookieMutations(NextResponse.json({ error: "Forbidden" }, { status: 403 }), cookieMutations)
    }
    console.error("[portfolio] update failed", error)
    const message = error instanceof Error ? error.message : "Failed to update portfolio"
    return applyCookieMutations(NextResponse.json({ error: message }, { status: 400 }), cookieMutations)
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const portfolioId = params.id

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

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const existing = await resolveUserPortfolio(supabase, portfolioId, user.id)
    if (!existing) {
      return NextResponse.json({ error: "Portfolio not found" }, { status: 404 })
    }

    const { error: deleteHoldingsError } = await supabase.from("portfolio_holdings").delete().eq("portfolio_id", portfolioId)
    if (deleteHoldingsError) throw deleteHoldingsError

    const { error: deletePortfolioError } = await supabase
      .from("portfolios")
      .delete()
      .eq("id", portfolioId)
      .eq("user_id", user.id)

    if (deletePortfolioError) throw deletePortfolioError

    const response = NextResponse.json({ ok: true }, { status: 200 })
    return applyCookieMutations(response, cookieMutations)
  } catch (error) {
    if (error instanceof Error && error.message === "Forbidden") {
      return applyCookieMutations(NextResponse.json({ error: "Forbidden" }, { status: 403 }), cookieMutations)
    }
    console.error("[portfolio] delete failed", error)
    const message = error instanceof Error ? error.message : "Failed to remove portfolio"
    return applyCookieMutations(NextResponse.json({ error: message }, { status: 400 }), cookieMutations)
  }
}
