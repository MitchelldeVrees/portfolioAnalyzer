"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import type { User } from "@supabase/supabase-js"
import { CheckCircle2, XCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { withCsrfHeaders } from "@/lib/security/csrf-client"
import { toast } from "@/hooks/use-toast"

type PortfolioOption = {
  id: string
  name: string | null
}

type ProfileSettingsProps = {
  user: User
  portfolios: PortfolioOption[]
}

type BusyAction = "password" | "download" | "purge" | "delete-account" | null

export function ProfileSettings({ user, portfolios }: ProfileSettingsProps) {
  const router = useRouter()
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [selectedPortfolio, setSelectedPortfolio] = useState<string>("")
  const [busy, setBusy] = useState<BusyAction>(null)
  const [passwordUpdated, setPasswordUpdated] = useState(false)

  const portfolioOptions = useMemo(
    () => portfolios.map((portfolio) => ({ ...portfolio, label: portfolio.name || "Untitled portfolio" })),
    [portfolios],
  )

  useEffect(() => {
    if (!selectedPortfolio && portfolioOptions.length > 0) {
      setSelectedPortfolio(portfolioOptions[0].id)
    }
  }, [portfolioOptions, selectedPortfolio])

  const passwordRequirements = useMemo(
    () => [
      { key: "length", label: "At least 12 characters", valid: newPassword.length >= 12 },
      { key: "upper", label: "Contains an uppercase letter", valid: /[A-Z]/.test(newPassword) },
      { key: "lower", label: "Contains a lowercase letter", valid: /[a-z]/.test(newPassword) },
      { key: "digit", label: "Contains a number", valid: /\d/.test(newPassword) },
      { key: "symbol", label: "Contains a symbol", valid: /[^A-Za-z0-9]/.test(newPassword) },
    ],
    [newPassword],
  )

  const passwordsMatch = confirmPassword.length > 0 && newPassword === confirmPassword
  const isPasswordStrong = passwordRequirements.every((req) => req.valid)
  const canSubmitPassword =
    isPasswordStrong && passwordsMatch && newPassword.length > 0 && confirmPassword.length > 0 && busy !== "password"

  useEffect(() => {
    if (!passwordUpdated) return
    if (newPassword.length === 0 && confirmPassword.length === 0) return
    setPasswordUpdated(false)
  }, [newPassword, confirmPassword, passwordUpdated])

  const handlePasswordChange = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isPasswordStrong) {
      toast({
        title: "Password too weak",
        description: "Make sure your password meets all listed requirements.",
        variant: "destructive",
      })
      return
    }
    if (!passwordsMatch) {
      toast({
        title: "Passwords do not match",
        description: "Check both fields and try again.",
        variant: "destructive",
      })
      return
    }
    setBusy("password")
    try {
      const response = await fetch(
        "/api/account/change-password",
        withCsrfHeaders({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newPassword }),
        }),
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.error || "Unable to change password")
      }
      setNewPassword("")
      setConfirmPassword("")
      toast({ title: "Password updated", description: "Your password was changed successfully." })
      setPasswordUpdated(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to change password"
      toast({ title: "Password update failed", description: message, variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const handleDownload = async () => {
    if (!selectedPortfolio) {
      toast({ title: "Select a portfolio", description: "Choose the portfolio you want to download.", variant: "destructive" })
      return
    }
    setBusy("download")
    try {
      const response = await fetch(`/api/account/portfolios/${selectedPortfolio}/download`)
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.error || "Download failed")
      }
      const blob = await response.blob()
      const suggestedName =
        response.headers.get("x-download-filename") ||
        `portfolio-${selectedPortfolio}-${new Date().toISOString().slice(0, 10)}.json`
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = suggestedName
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      toast({ title: "Download ready", description: "Your portfolio data has been exported." })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to download portfolio"
      toast({ title: "Download failed", description: message, variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const handleDeleteData = async () => {
    if (!window.confirm("Delete all portfolio data? This cannot be undone.")) return
    setBusy("purge")
    try {
      const response = await fetch("/api/account/delete-data", withCsrfHeaders({ method: "POST" }))
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to delete data")
      }
      toast({
        title: "Data deleted",
        description: "All portfolio records have been removed from your account.",
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete data"
      toast({ title: "Deletion failed", description: message, variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const handleDeleteAccount = async () => {
    if (!window.confirm("Delete your entire account? This action logs you out and removes everything.")) {
      return
    }
    setBusy("delete-account")
    try {
      const response = await fetch("/api/account/delete", withCsrfHeaders({ method: "POST" }))
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to delete account")
      }
      toast({ title: "Account deleted", description: "We hope to see you again." })
      router.push("/")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete account"
      toast({ title: "Deletion failed", description: message, variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
          
        <CardContent>
          <div className="grid gap-2">
            <Label>Email</Label>
            <p className="text-lg font-medium text-slate-900 dark:text-slate-100">{user.email}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>Set a new password for your account.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={handlePasswordChange}>
            <div className="grid gap-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
            id="new-password"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            minLength={12}
            required
            placeholder="Enter a strong password"
          />
        </div>
        <div className="grid gap-2">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <Input
            id="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            minLength={12}
            required
            placeholder="Re-enter your new password"
          />
        </div>
        <div className="space-y-2 text-sm">
          {passwordRequirements.map((requirement) => (
            <div
              key={requirement.key}
              className={`flex items-center gap-2 ${
                requirement.valid ? "text-green-600" : "text-slate-500 dark:text-slate-400"
              }`}
            >
              {requirement.valid ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <XCircle className="h-4 w-4 text-slate-400" />
              )}
              <span>{requirement.label}</span>
            </div>
          ))}
          <div
            className={`flex items-center gap-2 ${
              passwordsMatch ? "text-green-600" : "text-slate-500 dark:text-slate-400"
            }`}
          >
            {passwordsMatch ? (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            ) : (
              <XCircle className="h-4 w-4 text-slate-400" />
            )}
            <span>Passwords match</span>
          </div>
        </div>
        <div className="flex justify-between items-center">
          {passwordUpdated && (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              Password updated successfully
            </div>
          )}
          <Button type="submit" disabled={!canSubmitPassword}>
            {busy === "password" ? "Updating..." : "Update password"}
          </Button>
        </div>
      </form>
    </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Download portfolio data</CardTitle>
          <CardDescription>Export the holdings of a single portfolio as JSON.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="portfolio-select">Portfolio</Label>
            {portfolioOptions.length ? (
              <Select value={selectedPortfolio} onValueChange={setSelectedPortfolio}>
                <SelectTrigger id="portfolio-select">
                  <SelectValue placeholder="Select a portfolio" />
                </SelectTrigger>
                <SelectContent>
                  {portfolioOptions.map((portfolio) => (
                    <SelectItem key={portfolio.id} value={portfolio.id}>
                      {portfolio.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">You have not created any portfolios yet.</p>
            )}
          </div>
          <div className="flex justify-end">
            <Button onClick={handleDownload} disabled={!selectedPortfolio || busy === "download"}>
              {busy === "download" ? "Preparing..." : "Download JSON"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-red-200 dark:border-red-600">
        <CardHeader>
          <CardTitle>Danger zone</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-col gap-2 rounded-lg border border-slate-200/80 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/40 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-semibold text-slate-900 dark:text-slate-100">Delete portfolio data</p>
              <p className="text-sm text-muted-foreground">
                Removes every portfolio, holding, and snapshot tied to this account.
              </p>
            </div>
            <Button variant="secondary" onClick={handleDeleteData} disabled={busy === "purge"}>
              {busy === "purge" ? "Deleting..." : "Delete data"}
            </Button>
          </div>

          <div className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-semibold text-red-700 dark:text-red-300">Delete account</p>
              <p className="text-sm text-red-600/80 dark:text-red-300/80">
                Permanently deletes your account and logs you out immediately.
              </p>
            </div>
            <Button variant="destructive" onClick={handleDeleteAccount} disabled={busy === "delete-account"}>
              {busy === "delete-account" ? "Deleting..." : "Delete account"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
