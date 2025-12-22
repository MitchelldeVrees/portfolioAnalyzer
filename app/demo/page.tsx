import { PortfolioAnalysis } from "@/components/portfolio/portfolio-analysis"
import { demoAnalysis, demoHoldings, demoPortfolio, demoResearch, demoSummary } from "@/lib/demo/mock-portfolio-data"

export default function DemoPortfolioPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <PortfolioAnalysis
            portfolio={demoPortfolio}
            initialAnalysis={demoAnalysis}
            initialHoldings={demoHoldings}
            initialResearch={demoResearch}
            initialSummary={demoSummary}
            disableFetch
            readOnly
            deferInitialLoad
          />
        </div>
      </main>
    </div>
  )
}
