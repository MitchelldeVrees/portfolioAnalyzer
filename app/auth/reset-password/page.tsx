"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useCallback, useEffect, useMemo, useState } from "react"

import { LoadingButton } from "@/components/ui/loading-button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient as createBrowserSupabaseClient } from "@/lib/supabase/client"

type RecoveryTokens = {
  access_token: string | null
  refresh_token: string | null
  type: string | null
}

function parseTokensFromHash(hash: string): RecoveryTokens {
  if (!hash || hash[0] !== "#") return { access_token: null, refresh_token: null, type: null }
  const params = new URLSearchParams(hash.slice(1))
  return {
    access_token: params.get("access_token"),
    refresh_token: params.get("refresh_token"),
    type: params.get("type"),
  }
}

function ResetPasswordContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)
  const [tokens, setTokens] = useState<RecoveryTokens>({ access_token: null, refresh_token: null, type: null })
  const [sessionReady, setSessionReady] = useState(false)

  const supabase = useMemo(() => createBrowserSupabaseClient(), [])

  useEffect(() => {
    const fromQuery: RecoveryTokens = {
      access_token: searchParams.get("access_token"),
      refresh_token: searchParams.get("refresh_token"),
      type: searchParams.get("type"),
    }
    if (fromQuery.access_token && fromQuery.refresh_token) {
      setTokens(fromQuery)
      return
    }
    const parsedHash = parseTokensFromHash(window.location.hash)
    setTokens(parsedHash)
  }, [searchParams])

  useEffect(() => {
    if (!tokens.access_token || !tokens.refresh_token) return
    void supabase.auth.setSession({ access_token: tokens.access_token, refresh_token: tokens.refresh_token }).then((res) => {
      if (res.error) {
        setIsError(true)
        setMessage(res.error.message)
        return
      }
      setSessionReady(true)
    })
  }, [supabase, tokens])

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

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()

      if (!tokens.access_token || tokens.type !== "recovery") {
        setIsError(true)
        setMessage("Invalid reset link.")
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
      if (!sessionReady) {
        setIsError(true)
        setMessage("Please wait while we prepare your session.")
        return
      }

      setIsSubmitting(true)
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      setIsSubmitting(false)

      if (error) {
        setIsError(true)
        setMessage(error.message)
        return
      }

      await supabase.auth.signOut()
      setIsError(false)
      setMessage("Your password was updated. Redirecting to login…")
      setTimeout(() => router.replace("/auth/login"), 1500)
    },
    [tokens, passwordRequirements, passwordsMatch, sessionReady, supabase, newPassword, router],
  )

  if (!tokens.access_token || tokens.type !== "recovery") {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-50 dark:bg-slate-900 px-4">
        <Card className="w-full max-w-md">
          <CardContent className="space-y-4">
            <CardTitle className="text-lg font-semibold">Reset unavailable</CardTitle>
            <CardDescription className="text-sm text-slate-600 dark:text-slate-400">
              The link is missing or invalid. Please request a new reset from the login page.
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
          <CardDescription>Set a new password for your Portify account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
          {message && <p className={`text-sm ${isError ? "text-red-600" : "text-emerald-600"}`}>{message}</p>}
          <p className="text-xs text-slate-500">
            Once the password is reset you will be redirected back to the login screen automatically.
          </p>
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
