import { NextResponse, type NextRequest } from "next/server"

import { createServerClient } from "@/lib/supabase/server"

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; holdingId: string } },
) {
  try {
    const supabase = await createServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const payload = await request.json().catch(() => null)
    const quoteSymbol = payload?.quoteSymbol?.toString().trim()
    const currencyCode = payload?.currencyCode?.toString().trim().toUpperCase()

    if (!quoteSymbol && !currencyCode) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
    }

    const { data: holding, error: holdingError } = await supabase
      .from("portfolio_holdings")
      .select("id, portfolio_id, portfolios!inner(user_id)")
      .eq("id", params.holdingId)
      .eq("portfolio_id", params.id)
      .single()

    if (holdingError || !holding) {
      return NextResponse.json({ error: "Holding not found" }, { status: 404 })
    }

    if (holding.portfolios?.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const updatePayload: Record<string, string> = {}
    if (quoteSymbol) updatePayload.quote_symbol = quoteSymbol
    if (currencyCode) updatePayload.currency_code = currencyCode

    const { error: updateError } = await supabase
      .from("portfolio_holdings")
      .update(updatePayload)
      .eq("id", params.holdingId)

    if (updateError) {
      throw updateError
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[holdings] failed to update quote", error)
    return NextResponse.json({ error: "Unable to update holding" }, { status: 500 })
  }
}
