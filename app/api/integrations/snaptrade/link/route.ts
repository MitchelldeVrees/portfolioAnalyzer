import { NextResponse, type NextRequest } from "next/server"

import { applyCookieMutations, createRouteHandlerSupabase } from "@/lib/api/supabase-route"
import { assertSnaptradeConfigured, getSnaptradeClient } from "@/lib/snaptrade/client"
import { ensureSnaptradeCredentials } from "@/lib/snaptrade/server"
import type { CookieMutation } from "@/lib/api/supabase-route"
export const dynamic = "force-dynamic";
export const revalidate = 0;

type ConnectPayload = {
  broker?: string | null
}

export async function POST(request: NextRequest) {
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

    let payload: ConnectPayload | null = null
    try {
      payload = await request.json()
    } catch {
      payload = null
    }

    const broker = payload?.broker?.toString().trim() || undefined

    const { snaptradeUserId, snaptradeUserSecret } = await ensureSnaptradeCredentials(supabase, user.id)
    const snaptrade = getSnaptradeClient()

    const { data } = await snaptrade.authentication.loginSnapTradeUser({
      userId: snaptradeUserId,
      userSecret: snaptradeUserSecret,
      broker,
      connectionType: "read",
      showCloseButton: true,
      connectionPortalVersion: "v4",
    })

    if (!("redirectURI" in data) || !data.redirectURI) {
      throw new Error("SnapTrade did not return a connection URL")
    }

    return applyCookieMutations(
      NextResponse.json(
        {
          ok: true,
          redirectURI: data.redirectURI,
        },
        { status: 200 },
      ),
      cookieMutations,
    )
  } catch (error) {
    console.error("failed to create connection session", error)
    const message = error instanceof Error ? error.message : "Unable to start connection"
    return applyCookieMutations(NextResponse.json({ error: message }, { status: 500 }), cookieMutations)
  }
}
