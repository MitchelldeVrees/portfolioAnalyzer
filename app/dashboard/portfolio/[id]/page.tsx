import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { PortfolioAnalysis } from "@/components/portfolio/portfolio-analysis"

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function PortfolioPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()

  const { data, error } = await supabase.auth.getUser()
  if (error || !data?.user) {
    redirect("/auth/login")
  }

  // Get portfolio with holdings
  const { data: portfolio, error: portfolioError } = await supabase
    .from("portfolios")
    .select(`
      *,
      portfolio_holdings (*)
    `)
    .eq("id", id)
    .eq("user_id", data.user.id)
    .single()

  if (portfolioError || !portfolio) {
    redirect("/dashboard")
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <DashboardHeader user={data.user} />
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <PortfolioAnalysis portfolio={portfolio} />
        </div>
      </main>
    </div>
  )
}
