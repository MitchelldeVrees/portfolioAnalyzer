"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { startAuthentication } from "@simplewebauthn/browser"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { Badge } from "@/components/ui/badge"
import { withCsrfHeaders } from "@/lib/security/csrf-client"

type TotpState = {
  enabled: boolean
  pendingEnrollment: boolean
  enrolledAt?: string
}

type WebAuthnCredential = {
  id: string
  name: string
  createdAt: string
}

type WebAuthnState = {
  credentials: WebAuthnCredential[]
}

type MfaStatus = {
  ok: boolean
  requiresMfa: boolean
  requiresFirstLoginSetup: boolean
  mfa: {
    totp: TotpState
    webauthn: WebAuthnState
  }
}

export default function MfaVerifyPage() {
  const router = useRouter()
  const [status, setStatus] = useState<MfaStatus | null>(null)
  const [totpCode, setTotpCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)

  const hasTotp = status?.mfa.totp.enabled ?? false
  const hasWebAuthn = (status?.mfa.webauthn.credentials.length ?? 0) > 0

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/mfa/status")
      if (response.status === 401) {
        router.replace("/auth/login")
        return null
      }
      const payload = (await response.json()) as MfaStatus
      console.log(payload);
      setStatus(payload)
      if (payload.requiresFirstLoginSetup) {
        router.replace("/auth/mfa/setup")
        return payload
      }
      if (!payload.requiresMfa) {
        router.replace("/dashboard")
      }
      return payload
    } catch {
      setError("Unable to load MFA status. Please refresh.")
      return null
    }
  }, [router])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  const redirectToDashboard = useCallback(() => {
    router.replace("/dashboard")
  }, [router])

  const submitTotp = async () => {
    if (!totpCode.trim()) {
      setError("Enter the 6-digit code from your authenticator app")
      return
    }

    try {
      setBusyAction("totp")
      setError(null)
      const response = await fetch(
        "/api/auth/mfa/totp/verify",
        withCsrfHeaders({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: totpCode.trim() }),
        }),
      )
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error ?? "Verification failed")
      }
      setTotpCode("")
      await fetchStatus()
      redirectToDashboard()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to verify code")
    } finally {
      setBusyAction(null)
    }
  }

  const runWebAuthnAuthentication = async () => {
    try {
      setBusyAction("webauthn")
      setError(null)
      const optionsResponse = await fetch(
        "/api/auth/mfa/webauthn/authentication-options",
        withCsrfHeaders({ method: "POST" }),
      )
      const optionsPayload = await optionsResponse.json()
      if (!optionsResponse.ok) {
        throw new Error(optionsPayload?.error ?? "Unable to obtain authentication options")
      }

      const assertion = await startAuthentication(optionsPayload.options)

      const verifyResponse = await fetch(
        "/api/auth/mfa/webauthn/verify",
        withCsrfHeaders({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credential: assertion }),
        }),
      )
      const verifyPayload = await verifyResponse.json()
      if (!verifyResponse.ok) {
        throw new Error(verifyPayload?.error ?? "WebAuthn verification failed")
      }
      await fetchStatus()
      redirectToDashboard()
    } catch (err) {
      setError(err instanceof Error ? err.message : "WebAuthn authentication failed")
    } finally {
      setBusyAction(null)
    }
  }

  const ready = useMemo(() => Boolean(status && (status.requiresMfa || hasTotp || hasWebAuthn)), [status, hasTotp, hasWebAuthn])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-slate-100 to-slate-200 dark:from-slate-950 dark:via-slate-900 dark:to-slate-800 p-6">
      <Card className="w-full max-w-xl shadow-xl border-0 bg-white/80 backdrop-blur-sm dark:bg-slate-900/80">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-2xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2 justify-center">
            Verify Your Login
            <Badge variant="secondary">Step 2</Badge>
          </CardTitle>
          <CardDescription className="text-slate-600 dark:text-slate-400">
            Enter your one-time password or use a registered security key to finish signing in.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
              {error}
            </div>
          )}

          {!ready && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 text-center dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
              Checking security requirements...
            </div>
          )}

          {ready && (
            <div className="space-y-6">
              {hasTotp && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="totp-code" className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                      One-Time Code
                    </Label>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Open your authenticator app and enter the current 6-digit code.</p>
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <Input
                      id="totp-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value)}
                    />
                    <LoadingButton
                      loading={busyAction === "totp"}
                      onClick={submitTotp}
                      className="bg-blue-600 hover:bg-blue-500 text-white"
                    >
                      Verify Code
                    </LoadingButton>
                  </div>
                </div>
              )}

              
             

              {!hasTotp && !hasWebAuthn && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200 text-center">
                  No MFA factors are available for this account. Please contact support.
                </div>
              )}
            </div>
          )}

          <div className="text-center text-xs text-slate-500 dark:text-slate-400">
            Need to update your factors? Visit the <Button variant="link" className="p-0 h-auto" onClick={() => router.push("/auth/mfa/setup")}>setup page</Button> after logging in.
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
