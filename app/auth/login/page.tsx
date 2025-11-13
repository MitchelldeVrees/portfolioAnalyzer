"use client"

import { LoadingButton } from "@/components/ui/loading-button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { FormEvent, useState, useEffect } from "react"
import { withCsrfHeaders } from "@/lib/security/csrf-client"
import { Spinner } from "@/components/ui/spinner"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [showForgotForm, setShowForgotForm] = useState(false)
  const [forgotEmail, setForgotEmail] = useState("")
  const [isSendingReset, setIsSendingReset] = useState(false)
  const [resetMessage, setResetMessage] = useState<string | null>(null)
  const router = useRouter()

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(
        "/api/auth/login",
        withCsrfHeaders({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        }),
      )
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to sign in")
      }

      const beginRedirect = () => {
        setIsRedirecting(true)
        setIsLoading(false)
      }

      if (payload?.requiresFirstLoginSetup) {
        beginRedirect()
        router.push("/auth/mfa/setup")
      } else if (payload?.requiresMfa) {
        beginRedirect()
        router.push("/auth/mfa")
      } else {
        beginRedirect()
        router.push("/dashboard")
      }
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "Unable to sign in")
    } finally {
      setIsLoading(false)
    }
  }

  const handlePasswordReset = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!forgotEmail) return
    setIsSendingReset(true)
    setResetMessage(null)

    try {
      const response = await fetch(
        "/api/auth/forgot",
        withCsrfHeaders({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: forgotEmail }),
        }),
      )
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to send reset email")
      }
      setResetMessage("Check your inbox for a password reset link.")
    } catch (err) {
      setResetMessage(err instanceof Error ? err.message : "Unable to send reset email")
    } finally {
      setIsSendingReset(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4">
      <div className="w-full max-w-md">
        <Card className="shadow-xl border-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm relative overflow-hidden">
          {isRedirecting && (
            <div className="absolute inset-0 bg-white/70 dark:bg-slate-900/70 backdrop-blur-sm flex flex-col items-center justify-center z-10 space-y-3 text-center">
              <Spinner size="lg" className="text-blue-600 dark:text-blue-400" />
              <div>
                <p className="text-base font-medium text-slate-900 dark:text-slate-100">Preparing your dashboard</p>
                <p className="text-sm text-slate-600 dark:text-slate-400">Hang tight while we finish signing you in.</p>
              </div>
            </div>
          )}
          <CardHeader className="text-center pb-2">
            <div className="mx-auto w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
            </div>
            <CardTitle className="text-2xl font-bold text-slate-900 dark:text-slate-100">Portfolio Analyzer</CardTitle>
            <CardDescription className="text-slate-600 dark:text-slate-400">
              Sign in to analyze your investment portfolio
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-slate-700 dark:text-slate-300">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="investor@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="border-slate-200 dark:border-slate-700"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-slate-700 dark:text-slate-300">
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="border-slate-200 dark:border-slate-700"
                />
              </div>
              {error && (
                <div className="p-3 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400 rounded-lg border border-red-200 dark:border-red-800">
                  {error}
                </div>
              )}
              <LoadingButton
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                loading={isLoading}
                loadingText="Signing in..."
                spinnerPlacement="start"
              >
                Sign In
              </LoadingButton>
            </form>
            <div className="text-center text-sm text-slate-600 dark:text-slate-400">
              <button
                type="button"
                className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
                onClick={() => setShowForgotForm((prev) => !prev)}
              >
                Forgot your password?
              </button>
            </div>
            {showForgotForm && (
              <form onSubmit={handlePasswordReset} className="space-y-3 rounded-lg border border-dashed border-slate-200 p-4">
                <Label htmlFor="forgot-email" className="text-slate-700 dark:text-slate-300">
                  Enter your email to receive reset instructions
                </Label>
                <Input
                  id="forgot-email"
                  type="email"
                  required
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  className="border-slate-200 dark:border-slate-700"
                />
                <LoadingButton
                  type="submit"
                  className="w-full bg-slate-900 text-white"
                  loading={isSendingReset}
                  loadingText="Sending..."
                >
                  Send reset link
                </LoadingButton>
                {resetMessage && (
                  <p className="text-sm text-center text-slate-500 dark:text-slate-400">{resetMessage}</p>
                )}
              </form>
            )}
            <div className="text-center text-sm text-slate-600 dark:text-slate-400">
              {"Don't have an account? "}
              <Link
                href="/auth/signup"
                className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
              >
                Sign up
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
