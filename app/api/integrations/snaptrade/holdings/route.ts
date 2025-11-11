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

    const { data } = await snaptrade.accountInformation.getAllUserHoldings({
      userId: snaptradeUserId,
      userSecret: snaptradeUserSecret,
    })

    await supabase
      .from("profiles")
      .update({ snaptrade_last_sync: new Date().toISOString() })
      .eq("id", user.id)

    return applyCookieMutations(
      NextResponse.json(
        {
          ok: true,
          holdings: data,
        },
        { status: 200 },
      ),
      cookieMutations,
    )
  } catch (error) {
    console.error("[snaptrade] failed to load holdings", error)
    const message = error instanceof Error ? error.message : "Unable to load holdings"
    return applyCookieMutations(NextResponse.json({ error: message }, { status: 500 }), cookieMutations)
  }
}
