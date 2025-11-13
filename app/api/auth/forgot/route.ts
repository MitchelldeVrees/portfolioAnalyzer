import { NextRequest, NextResponse } from "next/server"

import { applyCookieMutations, createRouteHandlerSupabase } from "@/lib/api/supabase-route"
import type { CookieMutation } from "@/lib/api/supabase-route"
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Payload = {
  email?: string | null
}

export async function POST(request: NextRequest) {
  let cookieMutations: CookieMutation[] = []

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.json({ error: "Authentication service unavailable" }, { status: 503 })
  }

  try {
    const routeContext = createRouteHandlerSupabase(request)
    cookieMutations = routeContext.cookieMutations

    const payload = await request.json().catch(() => null) as Payload | null
    const email = payload?.email?.toString().trim().toLowerCase()

    if (!email) {
      return applyCookieMutations(NextResponse.json({ error: "Email is required" }, { status: 400 }), cookieMutations)
    }

    const { supabase } = routeContext
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/auth/reset-password`,
    })

    if (error) {
      return applyCookieMutations(NextResponse.json({ error: error.message }, { status: 400 }), cookieMutations)
    }

    return applyCookieMutations(NextResponse.json({ ok: true }, { status: 200 }), cookieMutations)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send reset link"
    return applyCookieMutations(NextResponse.json({ error: message }, { status: 500 }), cookieMutations)
  }
}
