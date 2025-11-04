import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { PortfolioList } from "@/components/dashboard/portfolio-list"
import { TickerSyncButton } from "@/components/admin/ticker-sync-button"
import { getSessionRole } from "@/lib/security/session"

export default async function DashboardPage() {
  const supabase = await createClient()

  const { data, error } = await supabase.auth.getUser()
  if (error || !data?.user) {
    redirect("/auth/login")
  }

  const role = getSessionRole(data.user as any)
  const isAdmin = role === "admin"

  // Get user's portfolios
  const { data: portfolios } = await supabase
    .from("portfolios")
    .select("*")
    .eq("user_id", data.user.id)
    .order("created_at", { ascending: false })




  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <DashboardHeader user={data.user} />
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <div className="mb-8 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-2">Your Portfolios</h1>
              <p className="text-slate-600 dark:text-slate-400">
                Upload, create, and analyze your investment portfolios
              </p>
            </div>
            {isAdmin && <TickerSyncButton />}
          </div>
          <PortfolioList portfolios={portfolios || []} />
        </div>
      </main>
    </div>
  )
}
