import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { ConnectPortfolioContent } from "@/components/portfolio/connect-portfolio-content"

export default async function ConnectPortfolioPage() {
  const supabase = await createClient()

  const { data, error } = await supabase.auth.getUser()
  if (error || !data?.user) {
    redirect("/auth/login")
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <DashboardHeader user={data.user} />
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto space-y-8">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Connect your portfolio</h1>
            <p className="text-slate-600 dark:text-slate-400">
              Upload a CSV export or launch the SnapTrade broker connection flow to sync holdings directly from Interactive Brokers and other supported custodians.
            </p>
          </div>

          <ConnectPortfolioContent />
        </div>
      </main>
    </div>
  )
}
