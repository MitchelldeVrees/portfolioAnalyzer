import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { PortfolioAnalysis } from "@/components/portfolio/portfolio-analysis"
import { getSnaptradeHoldingsDetails } from "@/lib/snaptrade/holdings"

interface PageProps {
  params: { id: string }
  searchParams?: { [key: string]: string | string[] | undefined }
}

const DEFAULT_BENCHMARK = "^GSPC";

export default async function PortfolioPage({ params, searchParams }: PageProps) {
  const { id } = params
  const supabase = await createClient()

  const { data, error } = await supabase.auth.getUser()
  if (error || !data?.user) {
    redirect("/auth/login")
  }

  const snaptradeDetails = await getSnaptradeHoldingsDetails(supabase, data.user.id)
  const snaptradeSummary = snaptradeDetails.status === "ok" ? snaptradeDetails.summary : null

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

  let initialAnalysis: any | null = null
  let initialHoldings: any | null = null

  try {
    const { data: analysisRow, error: analysisError } = await supabase
      .from("portfolio_analysis_snapshots")
      .select("payload")
      .eq("portfolio_id", id)
      .eq("benchmark", DEFAULT_BENCHMARK)
      .maybeSingle()
    if (!analysisError) {
      initialAnalysis = analysisRow?.payload ?? null
    }
  } catch {
    initialAnalysis = null
  }

  try {
    const { data: holdingsRow, error: holdingsError } = await supabase
      .from("portfolio_holdings_snapshots")
      .select("payload")
      .eq("portfolio_id", id)
      .eq("benchmark", DEFAULT_BENCHMARK)
      .maybeSingle()
    if (!holdingsError) {
      initialHoldings = holdingsRow?.payload ?? null
    }
  } catch {
    initialHoldings = null
  }

  const deferInitialLoad = searchParams?.deferAnalysis === "1"

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <DashboardHeader user={data.user} snaptradeSummary={snaptradeSummary} />
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <PortfolioAnalysis
            portfolio={portfolio}
            initialAnalysis={initialAnalysis}
            initialHoldings={initialHoldings}
            deferInitialLoad={deferInitialLoad}
          />
        </div>
      </main>
    </div>
  )
}
