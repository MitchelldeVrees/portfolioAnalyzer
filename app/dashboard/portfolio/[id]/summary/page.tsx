import { redirect } from "next/navigation"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { SummaryView } from "@/components/portfolio/summary-view"

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function PortfolioSummaryPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createServerClient()

  const { data, error } = await supabase.auth.getUser()
  if (error || !data?.user) redirect("/auth/login")

  // Ensure user owns the portfolio (lightweight check)
  const { data: p, error: pErr } = await supabase
    .from("portfolios")
    .select("id, user_id, name")
    .eq("id", id)
    .single()

  if (pErr || !p || p.user_id !== data.user.id) redirect("/dashboard")

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <DashboardHeader user={data.user} />
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <SummaryView portfolioId={id} portfolioName={p.name} />
        </div>
      </main>
    </div>
  )
}

