import { NextResponse, type NextRequest } from "next/server"

import { applyCookieMutations, createRouteHandlerSupabase } from "@/lib/api/supabase-route"
import { assertSnaptradeConfigured } from "@/lib/snaptrade/client"
import { getSnaptradeHoldingsDetails } from "@/lib/snaptrade/holdings"
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

    const details = await getSnaptradeHoldingsDetails(supabase, user.id)

    if (details.status === "pending" || details.status === "none") {
      const status = details.status === "pending" ? 425 : 412
      return applyCookieMutations(
        NextResponse.json({ error: details.pendingMessage ?? "Unable to load holdings" }, { status }),
        cookieMutations,
      )
    }

    await supabase
      .from("profiles")
      .update({ snaptrade_last_sync: new Date().toISOString() })
      .eq("id", user.id)

    return applyCookieMutations(
      NextResponse.json(
        {
          ok: true,
          holdings: details.accounts,
          summary: details.summary,
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
