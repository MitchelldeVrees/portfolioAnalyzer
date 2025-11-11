import { NextResponse, type NextRequest } from "next/server"

import { applyCookieMutations, createRouteHandlerSupabase } from "@/lib/api/supabase-route"
import { assertSnaptradeConfigured, getSnaptradeClient } from "@/lib/snaptrade/client"
import { ensureSnaptradeCredentials } from "@/lib/snaptrade/server"
import type { CookieMutation } from "@/lib/api/supabase-route"

export async function GET(request: NextRequest) {
  let cookieMutations: CookieMutation[] = []

  if (!assertSnaptradeConfigured()) {
    return NextResponse.json({ error: "SnapTrade is not configured" }, { status: 503 })
  }

  try {
    const routeContext = createRouteHandlerSupabase(request)
    cookieMutations = routeContext.cookieMutations
    const { supabase } = routeContext

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return applyCookieMutations(NextResponse.json({ error: "Not authenticated" }, { status: 401 }), cookieMutations)
    }

    const { snaptradeUserId, snaptradeUserSecret } = await ensureSnaptradeCredentials(supabase, user.id)
    const snaptrade = getSnaptradeClient()

    const { data } = await snaptrade.connections.listBrokerageAuthorizations({
      userId: snaptradeUserId,
      userSecret: snaptradeUserSecret,
    })

    const connections = (Array.isArray(data) ? data : []).map((auth) => ({
      id: auth.id ?? "",
      createdAt: auth.created_date ?? null,
      type: auth.type ?? "read",
      disabled: Boolean(auth.disabled),
      brokerage: auth.brokerage
        ? {
            slug: auth.brokerage.slug ?? auth.brokerage.name ?? auth.brokerage.id ?? "",
            name: auth.brokerage.display_name ?? auth.brokerage.name ?? auth.brokerage.slug ?? "Brokerage",
            logo: auth.brokerage.aws_s3_square_logo_url ?? auth.brokerage.aws_s3_logo_url ?? null,
          }
        : null,
    }))

    return applyCookieMutations(NextResponse.json({ ok: true, connections }, { status: 200 }), cookieMutations)
  } catch (error) {
    console.error("[snaptrade] failed to list connections", error)
    const message = error instanceof Error ? error.message : "Unable to load connections"
    return applyCookieMutations(NextResponse.json({ error: message }, { status: 500 }), cookieMutations)
  }
}
