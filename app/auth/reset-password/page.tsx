"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useCallback, useMemo, useState } from "react"

import { LoadingButton } from "@/components/ui/loading-button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient as createBrowserSupabaseClient } from "@/lib/supabase/client"

function ResetPasswordContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const supabase = useMemo(() => createBrowserSupabaseClient(), [])

  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)
  const [isSessionReady, setIsSessionReady] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const code = searchParams.get("code")
  const type = searchParams.get("type")

  const passwordRequirements = useMemo(
    () => [
      { key: "length", label: "At least 12 characters", valid: newPassword.length >= 12 },
      { key: "upper", label: "Uppercase letter", valid: /[A-Z]/.test(newPassword) },
      { key: "lower", label: "Lowercase letter", valid: /[a-z]/.test(newPassword) },
      { key: "number", label: "Number", valid: /\d/.test(newPassword) },
      { key: "symbol", label: "Symbol", valid: /[^A-Za-z0-9]/.test(newPassword) },
    ],
    [newPassword],
  )
  const passwordsMatch = confirmPassword === newPassword && confirmPassword.length > 0

  const handleExchange = useCallback(async () => {
    if (!code || type !== "recovery") {
      setIsError(true)
      setMessage("Invalid or expired reset link. Request a new one from the login screen.")
      return
    }

    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      setIsError(true)
      setMessage(error.message || "Unable to initialize reset session.")
      return
    }

    setIsError(false)
    setMessage("Session ready. Enter a new password below.")
    setIsSessionReady(true)
  }, [code, type, supabase])

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()

      if (!isSessionReady) {
        setIsError(true)
        setMessage("Please follow the recovery link from your email first.")
        return
      }
      if (!passwordRequirements.every((req) => req.valid)) {
        setIsError(true)
        setMessage("Please meet all password requirements.")
        return
      }
      if (!passwordsMatch) {
        setIsError(true)
        setMessage("Passwords must match.")
        return
      }

      setIsSubmitting(true)
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      setIsSubmitting(false)

      if (error) {
        setIsError(true)
        setMessage(error.message || "Unable to update password.")
        return
      }

      await supabase.auth.signOut()
      setIsError(false)
      setMessage("Password updated. Redirecting to sign in…")
      setTimeout(() => router.replace("/auth/login"), 1500)
    },
    [isSessionReady, passwordRequirements, passwordsMatch, newPassword, supabase, router],
  )

  if (!code || type !== "recovery") {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-50 dark:bg-slate-900 px-4">
        <Card className="w-full max-w-md">
          <CardContent className="space-y-4 py-6 text-center">
            <CardTitle className="text-lg font-semibold">Reset unavailable</CardTitle>
            <CardDescription className="text-sm text-slate-600 dark:text-slate-400">
              This link is missing a recovery code. Please request a new password reset from the login page.
            </CardDescription>
            <Link href="/auth/login" className="text-blue-600 hover:underline">
              Back to sign in
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 px-4 py-8">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Reset password</CardTitle>
          <CardDescription>Follow the steps to change your password.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isSessionReady ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Click the button below to verify this recovery link and continue.
              </p>
              <LoadingButton onClick={handleExchange} className="w-full">
                Verify link
              </LoadingButton>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="reset-password">New password</Label>
                <Input
                  id="reset-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reset-confirm">Confirm password</Label>
                <Input
                  id="reset-confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </div>
              <div className="space-y-1 text-sm">
                {passwordRequirements.map((requirement) => (
                  <p
                    key={requirement.key}
                    className={requirement.valid ? "text-emerald-600" : "text-slate-500 dark:text-slate-400"}
                  >
                    {requirement.label}
                  </p>
                ))}
                <p className={passwordsMatch ? "text-emerald-600" : "text-slate-500 dark:text-slate-400"}>
                  {passwordsMatch ? "Passwords match" : "Passwords must match"}
                </p>
              </div>
              <LoadingButton type="submit" loading={isSubmitting} loadingText="Updating..." className="w-full">
                Reset password
              </LoadingButton>
            </form>
          )}
          {message && <p className={`text-sm ${isError ? "text-red-600" : "text-emerald-600"}`}>{message}</p>}
        </CardContent>
      </Card>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen grid place-items-center bg-slate-50 dark:bg-slate-900 px-4">
          <Card className="w-full max-w-md">
            <CardContent className="py-6 text-center text-sm text-slate-500">
              Preparing reset form…
            </CardContent>
          </Card>
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  )
}
