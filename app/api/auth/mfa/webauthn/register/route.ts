import { createServerClient } from "@supabase/ssr"
import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies"
import { NextResponse, type NextRequest } from "next/server"

import {
  SESSION_AAL_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
  SESSION_MFA_REQUIRED_COOKIE_NAME,
  getSessionRole,
} from "@/lib/security/session"
import { readMfaState, updateMfaState, toPublicMfaState } from "@/lib/security/mfa-store"
import {
  WEBAUTHN_CHALLENGE_COOKIE_NAME,
  decodeChallenge,
  verifyRegistrationResponseForUser,
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

  const payload = await request.json().catch(() => null)
  const credential = payload?.credential
  const label = payload?.label?.toString().slice(0, 64) ?? "Security Key"

  if (!credential) {
    return NextResponse.json({ error: "Registration payload missing" }, { status: 400 })
  }

  const challengeToken = request.cookies.get(WEBAUTHN_CHALLENGE_COOKIE_NAME)?.value
  if (!challengeToken) {
    return NextResponse.json({ error: "Registration challenge expired" }, { status: 400 })
  }

  let challenge
  try {
    challenge = decodeChallenge(challengeToken)
  } catch (error) {
    return NextResponse.json({ error: "Invalid registration challenge" }, { status: 400 })
  }

  if (Date.now() - challenge.createdAt > 5 * 60 * 1000) {
    return NextResponse.json({ error: "Registration challenge expired" }, { status: 400 })
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

  if (!user || user.id !== challenge.userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const verification = await verifyRegistrationResponseForUser(credential, challenge.challenge)
  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: "Unable to verify credential" }, { status: 400 })
  }

  const { state } = await readMfaState(user.id)
  const credentialId = Buffer.from(verification.registrationInfo.credentialID).toString("base64url")

  if (state.webauthn?.credentials?.some((entry) => entry.id === credentialId)) {
    return NextResponse.json({ error: "Authenticator already registered" }, { status: 400 })
  }

  const publicKey = Buffer.from(verification.registrationInfo.credentialPublicKey).toString("base64url")
  const transports = Array.isArray(credential?.transports) ? credential.transports : undefined

  const { state: nextState } = await updateMfaState(user.id, (current) => {
    const nextCredentials = [...(current.webauthn?.credentials ?? [])]
    nextCredentials.push({
      id: credentialId,
      publicKey,
      counter: verification.registrationInfo.counter,
      transports,
      name: label,
      createdAt: new Date().toISOString(),
    })

    return {
      ...current,
      webauthn: {
        credentials: nextCredentials,
      },
    }
  })

  const { error: refreshError } = await supabase.auth.refreshSession()
  if (refreshError) {
    console.error("[mfa] failed to refresh session after webauthn registration", refreshError)
  }

  const role = getSessionRole(user)
  const response = NextResponse.json(
    {
      ok: true,
      role,
      mfa: toPublicMfaState(nextState),
    },
    { status: 200 },
  )

  response.cookies.set(WEBAUTHN_CHALLENGE_COOKIE_NAME, "", { ...SESSION_COOKIE_OPTIONS, maxAge: 0 })
  response.cookies.set(SESSION_AAL_COOKIE_NAME, "aal2", SESSION_COOKIE_OPTIONS)
  response.cookies.set(SESSION_MFA_REQUIRED_COOKIE_NAME, "0", SESSION_COOKIE_OPTIONS)

  return applyCookieMutations(response, cookieMutations)
}
