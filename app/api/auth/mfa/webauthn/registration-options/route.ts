import { Buffer } from "node:buffer"

import { createServerClient } from "@supabase/ssr"
import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies"
import { NextResponse, type NextRequest } from "next/server"

import { SESSION_COOKIE_OPTIONS } from "@/lib/security/session"
import { readMfaState } from "@/lib/security/mfa-store"
import {
  WEBAUTHN_CHALLENGE_COOKIE_NAME,
  createRegistrationOptions,
  encodeChallenge,
} from "@/lib/security/webauthn"

type CookieMutation = {
  name: string
  value: string
  options?: ResponseCookie
}

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

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: "Authentication service unavailable" }, { status: 500 })
  }

  const cookieMutations: CookieMutation[] = []

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieMutations.push({ name, value, options })
        })
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { state } = await readMfaState(user.id)
  const existingCredentials = state.webauthn?.credentials ?? []

  const userIdBytes = Buffer.from(user.id, "utf8")
  const options = createRegistrationOptions({
    userID: userIdBytes,
    userName: user.email ?? `user-${user.id}`,
    userDisplayName: user.email ?? "Authenticated User",
    excludeCredentials: existingCredentials.map((credential) => ({
      id: Buffer.from(credential.id, "base64url"),
      type: "public-key",
      transports: credential.transports,
    })),
  })

  const challengeToken = encodeChallenge({
    userId: user.id,
    challenge: options.challenge,
    type: "registration",
    createdAt: Date.now(),
  })

  const response = NextResponse.json({ ok: true, options }, { status: 200 })
  response.cookies.set(WEBAUTHN_CHALLENGE_COOKIE_NAME, challengeToken, {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: 300,
  })

  return applyCookieMutations(response, cookieMutations)
}
