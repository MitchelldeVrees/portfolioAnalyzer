import { createServerClient } from "@supabase/ssr"
import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies"
import { NextResponse, type NextRequest } from "next/server"

import {
  SESSION_AAL_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
  SESSION_IDLE_COOKIE_NAME,
  SESSION_ISSUED_COOKIE_NAME,
  SESSION_MFA_REQUIRED_COOKIE_NAME,
  SESSION_ROLE_COOKIE_NAME,
  getSessionRole,
} from "@/lib/security/session"
import {
  hasTotpFactor,
  hasWebAuthnFactor,
  readMfaState,
  toPublicMfaState,
  updateMfaState,
} from "@/lib/security/mfa-store"
import {
  WEBAUTHN_CHALLENGE_COOKIE_NAME,
  decodeChallenge,
  verifyAuthenticationResponseForUser,
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

  if (!credential) {
    return NextResponse.json({ error: "Assertion payload missing" }, { status: 400 })
  }

  const challengeToken = request.cookies.get(WEBAUTHN_CHALLENGE_COOKIE_NAME)?.value
  if (!challengeToken) {
    return NextResponse.json({ error: "Authentication challenge expired" }, { status: 400 })
  }

  let challenge
  try {
    challenge = decodeChallenge(challengeToken)
  } catch (error) {
    return NextResponse.json({ error: "Invalid authentication challenge" }, { status: 400 })
  }

  if (challenge.type !== "authentication" || Date.now() - challenge.createdAt > 5 * 60 * 1000) {
    return NextResponse.json({ error: "Authentication challenge expired" }, { status: 400 })
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

  const { state } = await readMfaState(user.id)
  const storedCredential = state.webauthn?.credentials?.find((entry) => entry.id === credential.id)
  if (!storedCredential) {
    return NextResponse.json({ error: "Unknown authenticator" }, { status: 400 })
  }

  const verification = await verifyAuthenticationResponseForUser(credential, challenge.challenge, storedCredential)
  if (!verification.verified || !verification.authenticationInfo) {
    return NextResponse.json({ error: "Authenticator validation failed" }, { status: 400 })
  }

  const newCounter = verification.authenticationInfo.newCounter

  const { state: nextState } = await updateMfaState(user.id, (current) => {
    const credentials = (current.webauthn?.credentials ?? []).map((entry) =>
      entry.id === storedCredential.id
        ? {
            ...entry,
            counter: newCounter,
          }
        : entry,
    )

    return {
      ...current,
      webauthn: {
        credentials,
      },
    }
  })

  const { error: refreshError } = await supabase.auth.refreshSession()
  if (refreshError) {
    console.error("[mfa] failed to refresh session after webauthn verification", refreshError)
  }

  const role = getSessionRole(user)
  const nowSeconds = Math.floor(Date.now() / 1000)

  const response = NextResponse.json(
    {
      ok: true,
      role,
      mfa: toPublicMfaState(nextState),
      remainingFactors: {
        totp: hasTotpFactor(nextState),
        webauthn: hasWebAuthnFactor(nextState),
      },
    },
    { status: 200 },
  )

  response.cookies.set(WEBAUTHN_CHALLENGE_COOKIE_NAME, "", { ...SESSION_COOKIE_OPTIONS, maxAge: 0 })
  response.cookies.set(SESSION_AAL_COOKIE_NAME, "aal2", SESSION_COOKIE_OPTIONS)
  response.cookies.set(SESSION_MFA_REQUIRED_COOKIE_NAME, "0", SESSION_COOKIE_OPTIONS)
  response.cookies.set(SESSION_IDLE_COOKIE_NAME, nowSeconds.toString(), SESSION_COOKIE_OPTIONS)
  response.cookies.set(SESSION_ISSUED_COOKIE_NAME, nowSeconds.toString(), SESSION_COOKIE_OPTIONS)
  response.cookies.set(SESSION_ROLE_COOKIE_NAME, role, SESSION_COOKIE_OPTIONS)

  return applyCookieMutations(response, cookieMutations)
}
