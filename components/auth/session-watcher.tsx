"use client"

import { useEffect, useMemo } from "react"
import { usePathname, useRouter } from "next/navigation"

import { withCsrfHeaders } from "@/lib/security/csrf-client"

const PROTECTED_PATH_PREFIXES = ["/dashboard", "/account"]
const CHECK_INTERVAL_MS = 60_000
const RETRY_INTERVAL_MS = 15_000

export function SessionWatcher() {
  const pathname = usePathname()
  const router = useRouter()

  const shouldWatch = useMemo(() => {
    if (!pathname) return false
    return PROTECTED_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  }, [pathname])

  useEffect(() => {
    if (!shouldWatch) return

    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const clearTimer = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
    }

    const scheduleCheck = (delay: number) => {
      clearTimer()
      timeoutId = setTimeout(() => {
        void checkSession()
      }, delay)
    }

    const handleLogout = async () => {
      cancelled = true
      clearTimer()
      try {
        await fetch("/api/auth/logout", withCsrfHeaders({ method: "POST" }))
      } catch {
        // Best-effort cleanup, errors can be ignored here.
      }
      router.replace("/auth/login")
      router.refresh()
    }

    const checkSession = async () => {
      try {
        const response = await fetch("/api/auth/status", {
          cache: "no-store",
        })

        if (response.status === 401) {
          await handleLogout()
          return
        }

        if (!response.ok) {
          scheduleCheck(RETRY_INTERVAL_MS)
          return
        }

        if (!cancelled) {
          scheduleCheck(CHECK_INTERVAL_MS)
        }
      } catch {
        if (!cancelled) {
          scheduleCheck(RETRY_INTERVAL_MS)
        }
      }
    }

    scheduleCheck(0)

    return () => {
      cancelled = true
      clearTimer()
    }
  }, [shouldWatch, router])

  return null
}
