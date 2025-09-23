import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { PortfolioList } from "@/components/dashboard/portfolio-list"

export default async function DashboardPage() {
  const supabase = await createClient()

  const { data, error } = await supabase.auth.getUser()
  if (error || !data?.user) {
    redirect("/auth/login")
  }

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
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-2">Your Portfolios</h1>
            <p className="text-slate-600 dark:text-slate-400">Upload, create, and analyze your investment portfolios</p>
          </div>
          <PortfolioList portfolios={portfolios || []} />
        </div>
      </main>
    </div>
  )
}
