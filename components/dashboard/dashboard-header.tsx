"use client"
import { useMemo } from "react"
import { Button } from "@/components/ui/button"
import { useRouter } from "next/navigation"
import Image from "next/image"
import Link from "next/link"
import type { User } from "@supabase/supabase-js"
import { withCsrfHeaders } from "@/lib/security/csrf-client"

interface DashboardHeaderProps {
  user: User
  snaptradeSummary?: { total: number; currency?: string | null } | null
}

export function DashboardHeader({ user, snaptradeSummary }: DashboardHeaderProps) {
  const router = useRouter()

  const handleSignOut = async () => {
    await fetch("/api/auth/logout", withCsrfHeaders({ method: "POST" }))
    router.push("/")
  }

  const formattedSnaptradeBalance = useMemo(() => {
    if (!snaptradeSummary || typeof snaptradeSummary.total !== "number") return null
    try {
      const currency = snaptradeSummary.currency ?? "USD"
      return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(snaptradeSummary.total)
    } catch {
      return `${snaptradeSummary.total.toFixed(2)}${snaptradeSummary.currency ? ` ${snaptradeSummary.currency}` : ""}`
    }
  }, [snaptradeSummary])

  return (
    <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <Link href="/dashboard" className="flex items-center space-x-3">
            <Image src="/portifyNoBackground.png" alt="Portify logo" width={150} height={150} className="object-contain" />
          </Link>
          <div className="flex items-center space-x-4">
            {formattedSnaptradeBalance && (
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-slate-400">SnapTrade balance</p>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{formattedSnaptradeBalance}</p>
              </div>
            )}
            <Link
              href="/account"
              className="text-sm font-medium text-slate-600 transition hover:text-blue-600 dark:text-slate-300"
            >
              {user.email}
            </Link>
            <Button variant="outline" onClick={handleSignOut}>
              Sign Out
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}
