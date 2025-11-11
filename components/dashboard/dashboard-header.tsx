"use client"
import { Button } from "@/components/ui/button"
import { useRouter } from "next/navigation"
import Image from "next/image"
import Link from "next/link"
import type { User } from "@supabase/supabase-js"
import { withCsrfHeaders } from "@/lib/security/csrf-client"

interface DashboardHeaderProps {
  user: User
}

export function DashboardHeader({ user }: DashboardHeaderProps) {
  const router = useRouter()

  const handleSignOut = async () => {
    await fetch("/api/auth/logout", withCsrfHeaders({ method: "POST" }))
    router.push("/")
  }

  return (
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <Link href="/dashboard" className="flex items-center space-x-3">
              <Image src="/portifyNoBackground.png" alt="Portify logo" width={150} height={150} className="object-contain" />
            </Link>
            <div className="flex items-center space-x-4">
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
