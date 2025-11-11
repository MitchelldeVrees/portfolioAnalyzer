import { NextResponse, type NextRequest } from "next/server"

import { applyCookieMutations, createRouteHandlerSupabase } from "@/lib/api/supabase-route"
import { getSnaptradeClient } from "@/lib/snaptrade/client"

export async function GET(request: NextRequest) {
  let cookieMutations = []

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

    const snaptrade = getSnaptradeClient()
    const { data } = await snaptrade.referenceData.listAllBrokerages()

    const brokerages = (Array.isArray(data) ? data : []).map((brokerage) => ({
      id: brokerage.id ?? brokerage.slug ?? "",
      slug: brokerage.slug ?? "",
      name: brokerage.display_name ?? brokerage.name ?? brokerage.slug ?? "Brokerage",
      description: brokerage.description ?? null,
      logo: brokerage.aws_s3_square_logo_url ?? brokerage.aws_s3_logo_url ?? null,
      allowsTrading: Boolean(brokerage.allows_trading),
      maintenanceMode: Boolean(brokerage.maintenance_mode),
      enabled: brokerage.enabled !== false,
    }))

    return applyCookieMutations(NextResponse.json({ ok: true, brokerages }, { status: 200 }), cookieMutations)
  } catch (error) {
    console.error("[snaptrade] failed to list brokerages", error)
    const message = error instanceof Error ? error.message : "Unable to load brokerages"
    return applyCookieMutations(NextResponse.json({ error: message }, { status: 500 }), cookieMutations)
  }
}
