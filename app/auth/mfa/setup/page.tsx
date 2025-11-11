"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { startRegistration } from "@simplewebauthn/browser"
import { toDataURL } from "qrcode"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
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

type EnrollmentSecret = {
  secret: string
  otpauthUrl: string
  issuer: string
}

export default function MfaSetupPage() {
  const router = useRouter()

  const [status, setStatus] = useState<MfaStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [totpCode, setTotpCode] = useState("")
  const [enrollmentSecret, setEnrollmentSecret] = useState<EnrollmentSecret | null>(null)
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null)
  const [label, setLabel] = useState("Security Key")
  const [busyAction, setBusyAction] = useState<string | null>(null)

  const forcingSetup = status?.requiresFirstLoginSetup ?? false
  const hasTotp = status?.mfa.totp.enabled ?? false
  const totpPending = status?.mfa.totp.pendingEnrollment ?? false
  const hasWebAuthn = (status?.mfa.webauthn.credentials.length ?? 0) > 0

  const fetchStatus = async () => {
    try {
      const response = await fetch("/api/auth/mfa/status")
      if (response.status === 401) {
        router.replace("/auth/login")
        return null
      }
      const payload = (await response.json()) as MfaStatus
      setStatus(payload)
      if (!payload.mfa.totp.pendingEnrollment) {
        setEnrollmentSecret(null)
      }
      return payload
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load security status")
      return null
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
        .catch(() => active && setQrCodeDataUrl(null))
    } else {
      setQrCodeDataUrl(null)
    }
    return () => {
      active = false
    }
  }, [enrollmentSecret?.otpauthUrl])

  const redirectToDashboard = () => {
    router.replace("/dashboard")
  }

  const ensureCodePresent = () => {
    if (!totpCode.trim()) {
      setError("Enter the 6-digit code from your authenticator app")
      return false
    }
    return true
  }

  const submitTotp = async () => {
    if (!ensureCodePresent()) return

    try {
      const wasForced = status?.requiresFirstLoginSetup ?? false
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
      if (wasForced) {
        redirectToDashboard()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to verify code")
    } finally {
      setBusyAction(null)
    }
  }

  const startTotpEnrollment = async () => {
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
    if (!hasTotp) return
    if (!ensureCodePresent()) return

    try {
      setBusyAction("totp-disable")
      setError(null)
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
      setLabel("Security Key")
      await fetchStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : "WebAuthn registration failed")
    } finally {
      setBusyAction(null)
    }
  }

  const summaryMessage = useMemo(() => {
    if (forcingSetup) {
      return "Complete at least one MFA factor to finish your first login."
    }
    if (hasTotp) {
      return "TOTP is enabled. You can reset or disable it below."
    }
    return "Protect your account by enabling authenticator codes."
  }, [forcingSetup, hasTotp])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-slate-100 to-slate-200 dark:from-slate-950 dark:via-slate-900 dark:to-slate-800 p-6">
      <Card className="w-full max-w-5xl shadow-xl border-0 bg-white/80 backdrop-blur-sm dark:bg-slate-900/80">
        <CardHeader className="text-center pb-2 space-y-2">
          <CardTitle className="text-3xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-3 justify-center">
            Secure Your Account
            {forcingSetup && <Badge variant="destructive">Required</Badge>}
          </CardTitle>
          <CardDescription className="text-slate-600 dark:text-slate-400">
            {summaryMessage}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-10">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
              {error}
            </div>
          )}

          <section className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Authenticator App (TOTP)</h2>
                {hasTotp && <Badge variant="outline">Enabled</Badge>}
                {totpPending && <Badge variant="secondary">Pending confirmation</Badge>}
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Scan the QR code below or enter the secret manually in any TOTP-compatible app such as 1Password, Authy, or Google Authenticator.
              </p>
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
                <p className="text-xs text-slate-500 mt-1">
                  Use this field to confirm new secrets or to disable TOTP. Codes expire every 30 seconds.
                </p>
              </div>
              <LoadingButton
                loading={busyAction === "totp"}
                onClick={submitTotp}
                className="bg-blue-600 hover:bg-blue-500 text-white"
              >
                Verify & Enable
              </LoadingButton>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={startTotpEnrollment} disabled={busyAction === "totp-enroll"}>
                {hasTotp ? (totpPending ? "Regenerate Secret" : "Reset TOTP") : "Generate Secret"}
              </Button>
              {hasTotp && (
                <Button variant="destructive" onClick={disableTotp} disabled={busyAction === "totp-disable"}>
                  Disable TOTP
                </Button>
              )}
            </div>
          </section>

          

          {!forcingSetup && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 flex items-center justify-between dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-200">
              <span className="font-medium">All done here? Head back to your dashboard.</span>
              <Button variant="secondary" onClick={redirectToDashboard} className="ml-4">
                Go to dashboard
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
