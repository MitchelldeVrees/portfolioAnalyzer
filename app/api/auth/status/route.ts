import { NextResponse, type NextRequest } from "next/server"

import { applyCookieMutations, createRouteHandlerSupabase } from "@/lib/api/supabase-route"

export async function GET(request: NextRequest) {
  try {
    const { supabase, cookieMutations } = createRouteHandlerSupabase(request)
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user) {
      const response = NextResponse.json({ authenticated: false }, { status: 401 })
      return applyCookieMutations(response, cookieMutations)
    }

    return applyCookieMutations(NextResponse.json({ authenticated: true }), cookieMutations)
  } catch (err) {
    console.error("[auth] Failed to determine session status", err)
    return NextResponse.json({ error: "Unable to verify session" }, { status: 500 })
  }
}
