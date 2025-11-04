"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { startAuthentication, startRegistration } from "@simplewebauthn/browser"
import { toDataURL } from "qrcode"

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
  requiresEnrollment: boolean
  mfa: {
    totp: TotpState
    webauthn: WebAuthnState
  }
}

type EnrollmentSecret = {
  secret: string
  otpauthUrl: string
  issuer: string
}

export default function MfaPage() {
  const router = useRouter()

  const [status, setStatus] = useState<MfaStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [totpCode, setTotpCode] = useState("")
  const [enrollmentSecret, setEnrollmentSecret] = useState<EnrollmentSecret | null>(null)
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null)
  const [label, setLabel] = useState("")
  const [busyAction, setBusyAction] = useState<string | null>(null)

  const hasTotp = status?.mfa.totp.enabled ?? false
  const totpPending = status?.mfa.totp.pendingEnrollment ?? false
  const hasWebAuthn = (status?.mfa.webauthn.credentials.length ?? 0) > 0
  const requiresEnrollment = status?.requiresEnrollment ?? false

  const allowTotpEnrollment = totpPending || !hasTotp

  const fetchStatus = async () => {
    try {
      const response = await fetch("/api/auth/mfa/status")
      if (!response.ok) {
        throw new Error("Unable to load MFA status")
      }
      const payload = (await response.json()) as MfaStatus
      setStatus(payload)
      if (!payload.mfa.totp.pendingEnrollment) {
        setEnrollmentSecret(null)
      }
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load MFA status")
    }
  }

  useEffect(() => {
    fetchStatus()
  }, [])

  useEffect(() => {
    let active = true
    if (enrollmentSecret?.otpauthUrl) {
      toDataURL(enrollmentSecret.otpauthUrl, { margin: 1 })
        .then((dataUrl) => {
          if (active) setQrCodeDataUrl(dataUrl)
        })
        .catch(() => {
          if (active) setQrCodeDataUrl(null)
        })
    } else {
      setQrCodeDataUrl(null)
    }
    return () => {
      active = false
    }
  }, [enrollmentSecret?.otpauthUrl])

  const redirectToDashboard = () => {
    router.push("/dashboard")
  }

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

  const startTotpEnrollment = async () => {
    if (!allowTotpEnrollment) return
    try {
      setBusyAction("totp-enroll")
      setError(null)
      const response = await fetch("/api/auth/mfa/totp/enroll", withCsrfHeaders({ method: "POST" }))
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to start TOTP enrollment")
      }
      setEnrollmentSecret(payload)
      await fetchStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start TOTP enrollment")
    } finally {
      setBusyAction(null)
    }
  }

  const disableTotp = async () => {
    if (!totpPending) return
    try {
      setBusyAction("totp-disable")
      setError(null)
      if (!totpCode.trim()) {
        setError("Enter your 6-digit code to confirm disabling TOTP")
        return
      }
      const response = await fetch(
        "/api/auth/mfa/totp/disable",
        withCsrfHeaders({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: totpCode.trim() }),
        }),
      )
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to disable TOTP")
      }
      setTotpCode("")
      setEnrollmentSecret(null)
      await fetchStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disable TOTP")
    } finally {
      setBusyAction(null)
    }
  }

  const runWebAuthnRegistration = async () => {
    try {
      setBusyAction("webauthn-register")
      setError(null)
      const optionsResponse = await fetch(
        "/api/auth/mfa/webauthn/registration-options",
        withCsrfHeaders({ method: "POST" }),
      )
      const optionsPayload = await optionsResponse.json()
      if (!optionsResponse.ok) {
        throw new Error(optionsPayload?.error ?? "Unable to obtain registration options")
      }

      const attestation = await startRegistration(optionsPayload.options)

      const verifyResponse = await fetch(
        "/api/auth/mfa/webauthn/register",
        withCsrfHeaders({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credential: attestation, label: label.trim() || "Security Key" }),
        }),
      )
      const verifyPayload = await verifyResponse.json()
      if (!verifyResponse.ok) {
        throw new Error(verifyPayload?.error ?? "Authenticator registration failed")
      }
      setLabel("")
      await fetchStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : "WebAuthn registration failed")
    } finally {
      setBusyAction(null)
    }
  }

  const runWebAuthnAuthentication = async () => {
    try {
      setBusyAction("webauthn-verify")
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

  const needsVerification = useMemo(() => {
    if (!status) return false
    return status.requiresMfa
  }, [status])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-slate-100 to-slate-200 dark:from-slate-950 dark:via-slate-900 dark:to-slate-800 p-6">
      <Card className="w-full max-w-4xl shadow-xl border-0 bg-white/80 backdrop-blur-sm dark:bg-slate-900/80">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-2xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2 justify-center">
            Secure Your Account
            {status?.requiresMfa && <Badge variant="secondary">MFA Required</Badge>}
          </CardTitle>
          <CardDescription className="text-slate-600 dark:text-slate-400">
            Complete multi-factor authentication to continue. Administrators must keep at least one factor enabled.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
              {error}
            </div>
          )}

          <section className="space-y-4">
            <div className="space-y-2 text-left">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Authenticator App (TOTP)</h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Scan the QR code with an authenticator app (1Password, Authy, Google Authenticator) or enter the secret manually to generate verification codes.
              </p>
              {needsVerification && (
                <p className="text-xs font-medium text-blue-600 dark:text-blue-300">
                  Verification required before you can proceed.
                </p>
              )}
            </div>

            {enrollmentSecret && (
              <div className="rounded-lg border border-blue-200 bg-blue-50/80 dark:border-blue-900/50 dark:bg-blue-900/20 p-4 flex flex-col md:flex-row md:items-center gap-4">
                <div className="flex items-center justify-center">
                  {qrCodeDataUrl ? (
                    <img
                      src={qrCodeDataUrl}
                      alt="TOTP enrollment QR code"
                      className="h-32 w-32 rounded-md border border-blue-200 bg-white p-2 dark:border-blue-800"
                    />
                  ) : (
                    <div className="h-32 w-32 rounded-md border border-dashed border-blue-300 flex items-center justify-center text-sm text-blue-500">
                      Generating QR…
                    </div>
                  )}
                </div>
                {!hasTotp && (
                  <div className="space-y-2 text-left">
                    <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">Secret</p>
                    <p className="font-mono text-lg tracking-wider text-blue-900 dark:text-blue-50 break-all">
                      {enrollmentSecret.secret}
                    </p>
                    <p className="text-xs text-blue-800 dark:text-blue-200">
                      Manual entry URL: <span className="break-all">{enrollmentSecret.otpauthUrl}</span>
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <Label htmlFor="totp-code">One-Time Code</Label>
                <Input
                  id="totp-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                />
              </div>
              <LoadingButton
                loading={busyAction === "totp"}
                onClick={submitTotp}
                className="bg-blue-600 hover:bg-blue-500 text-white"
              >
                Verify Code
              </LoadingButton>
            </div>

            <div className="flex flex-wrap gap-2">
              {allowTotpEnrollment && (
                <Button
                  variant="secondary"
                  onClick={startTotpEnrollment}
                  disabled={busyAction === "totp-enroll"}
                >
                  {totpPending ? (hasTotp ? "Regenerate Secret" : "Continue Setup") : "Set Up TOTP"}
                </Button>
              )}

              {totpPending && (
                <Button variant="destructive" onClick={disableTotp} disabled={busyAction === "totp-disable"}>
                  Cancel Pending Setup
                </Button>
              )}
            </div>
          </section>

          <section className="space-y-4">
            

            {hasWebAuthn && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Registered Authenticators</h3>
                <ul className="space-y-2">
                  {status?.mfa.webauthn.credentials.map((cred) => (
                    <li
                      key={cred.id}
                      className="rounded-md border border-slate-200 bg-white px-4 py-3 flex items-center justify-between dark:border-slate-700 dark:bg-slate-900/60"
                    >
                      <div>
                        <p className="font-medium text-slate-900 dark:text-slate-100">{cred.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Added {new Date(cred.createdAt).toLocaleString(undefined, { dateStyle: "medium" })}
                        </p>
                      </div>
                      <Badge variant="outline">Ready</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {status && !status.requiresMfa && !requiresEnrollment && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 flex items-center justify-between dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-200">
              <span className="font-medium">MFA complete. You can continue to your dashboard.</span>
              <Button variant="secondary" onClick={redirectToDashboard} className="ml-4">
                Continue
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
