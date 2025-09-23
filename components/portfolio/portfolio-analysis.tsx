"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowLeft, Edit3, TrendingUp, TrendingDown, Minus, FileText } from "lucide-react"
import Link from "next/link"
import { formatDistanceToNow } from "date-fns"
import { PerformanceChart } from "./performance-chart"
import { AllocationChart } from "./allocation-chart"
import { HoldingsAnalysis } from "./holdings-analysis"
import { NewsResearch } from "./news-research"
import { PortfolioSummaryReport } from "./portfolio-summary-report"
import { useEffect, useState } from "react"

interface PortfolioHolding {
  id: string
  ticker: string
  weight: number
  shares?: number
  purchase_price?: number
  purchase_date?: string | null
}

interface Portfolio {
  id: string
  name: string
  description?: string
  created_at: string
  updated_at: string
  portfolio_holdings: PortfolioHolding[]
}

interface PortfolioAnalysisProps {
  portfolio: Portfolio
}

export function PortfolioAnalysis({ portfolio }: PortfolioAnalysisProps) {
  const [portfolioData, setPortfolioData] = useState<any>(null)
  const [benchmark, setBenchmark] = useState("^GSPC")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function fetchPortfolioData() {
      try {
        setLoading(true)
        const response = await fetch(`/api/portfolio/${portfolio.id}/data?benchmark=${encodeURIComponent(benchmark)}`)
        if (!response.ok) throw new Error("Failed to fetch portfolio data")
        const data = await response.json()
        if (!cancelled) setPortfolioData(data)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load data")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchPortfolioData()
    return () => {
      cancelled = true
    }
  }, [portfolio.id, benchmark])

  // Pre-generate research on first load so it's ready when opening the tab
  useEffect(() => {
    fetch(`/api/portfolio/${portfolio.id}/research`).catch(() => {})
  }, [portfolio.id])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-600 dark:text-slate-400">Loading portfolio analysis...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600 dark:text-red-400">Error: {error}</p>
        <Button onClick={() => window.location.reload()} className="mt-4">
          Retry
        </Button>
      </div>
    )
  }

  const hasBenchmark: boolean = !!portfolioData?.performanceMeta?.hasBenchmark
  const benchmarkLabel: string | undefined = portfolioData?.performanceMeta?.benchmark
  const missingMsg = "Add purchase price & date for all holdings to enable benchmark."

  const portfolioReturn: number = portfolioData?.metrics?.portfolioReturn ?? 0
  const benchmarkReturn: number | null = portfolioData?.metrics?.benchmarkReturn ?? null
  const volatility: number = portfolioData?.metrics?.volatility ?? 0
  const sharpeRatio: number = portfolioData?.metrics?.sharpeRatio ?? 0
  const maxDrawdown: number = portfolioData?.metrics?.maxDrawdown ?? 0
  const beta: number | undefined = portfolioData?.metrics?.beta

  const diversificationScore: number | undefined = portfolioData?.risk?.diversification?.score

  // NEW: SPX comparison beta fields
  const portfolioBetaSpx: number | null = portfolioData?.metrics?.portfolioBetaSpx ?? null
  const spxBeta: number = portfolioData?.metrics?.spxBeta ?? 1.0
  const betaDiff: number | null = portfolioData?.metrics?.betaDiff ?? null


  const getPerformanceIcon = (value: number) => {
    if (value > 0) return <TrendingUp className="w-4 h-4 text-green-600" />
    if (value < 0) return <TrendingDown className="w-4 h-4 text-red-600" />
    return <Minus className="w-4 h-4 text-slate-600" />
  }

  const getPerformanceColor = (value: number) => {
    if (value > 0) return "text-green-600 dark:text-green-400"
    if (value < 0) return "text-red-600 dark:text-red-400"
    return "text-slate-600 dark:text-slate-400"
  }

  const diversificationColor = (score?: number) => {
    if (typeof score !== "number") return "text-slate-900 dark:text-slate-100"
    if (score <= 4) return "text-red-600 dark:text-red-400" // 0–4 → red
    if (score <= 6.5) return "text-amber-500 dark:text-amber-400" // 4.1–6.5 → yellow/orange
    return "text-green-600 dark:text-green-400" // >6.5 → green
  }

  const sectorsForChart =
  (portfolioData?.sectors ?? []).filter((s: any) => (s.allocation ?? 0) > 0.05) // ignore ~0% after rounding


  // --- Active tilts & similarity (sector-level) ---
  const sectorsAll = (portfolioData?.sectors ?? []) as Array<{
    sector: string; allocation: number; target: number; color?: string;
  }>;

  const diffs = sectorsAll.map(s => ({
    ...s,
    diff: Number((s.allocation - s.target).toFixed(1)), // +over / -under vs benchmark
  }));

  // Active Share (%) at sector level: 0.5 * sum(|differences in percentage points|)
  const sumAbs = diffs.reduce((acc, s) => acc + Math.abs(s.diff), 0);
  const activeSharePct = Number((0.5 * sumAbs).toFixed(1)); // 0..100

  // Cosine similarity as a rough “match score” (0..100)
  const dot = sectorsAll.reduce((acc, s) => acc + (s.allocation || 0) * (s.target || 0), 0);
  const normP = Math.sqrt(sectorsAll.reduce((acc, s) => acc + Math.pow(s.allocation || 0, 2), 0));
  const normB = Math.sqrt(sectorsAll.reduce((acc, s) => acc + Math.pow(s.target || 0, 2), 0));
  const matchScore = normP && normB ? Math.round((dot / (normP * normB)) * 100) : null;

  // Top tilts
  const topOver = diffs.filter(d => d.diff > 0.5).sort((a,b) => b.diff - a.diff).slice(0,3);
  const topUnder = diffs.filter(d => d.diff < -0.5).sort((a,b) => a.diff - b.diff).slice(0,3);


  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">{portfolio.name}</h1>
            {portfolio.description && (
              <p className="text-slate-600 dark:text-slate-400 mt-1">{portfolio.description}</p>
            )}
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Created {formatDistanceToNow(new Date(portfolio.created_at), { addSuffix: true })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-sm text-slate-600 dark:text-slate-400">Benchmark</div>
          <Select value={benchmark} onValueChange={(v) => setBenchmark(v)}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="^GSPC">S&amp;P 500 (^GSPC)</SelectItem>
              <SelectItem value="^NDX">NASDAQ 100 (^NDX)</SelectItem>
              <SelectItem value="URTH">MSCI World (URTH)</SelectItem>
              <SelectItem value="VT">Global (VT)</SelectItem>
              <SelectItem value="VEA">Developed ex-US (VEA)</SelectItem>
              <SelectItem value="EEM">Emerging (EEM)</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="outline" asChild>
            <Link href={`/dashboard/portfolio/${portfolio.id}/edit`}>
              <Edit3 className="w-4 h-4 mr-2" />
              Edit Portfolio
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid md:grid-cols-5 gap-4">
        {/* Portfolio Return */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">Portfolio Return</CardTitle>
          </CardHeader>
          <CardContent>
            {!hasBenchmark ? (
              <div className="text-sm text-slate-500">{missingMsg}</div>
            ) : (
              <div className={`text-2xl font-bold flex items-center space-x-2 ${getPerformanceColor(portfolioReturn)}`}>
                {getPerformanceIcon(portfolioReturn)}
                <span>
                  {portfolioReturn > 0 ? "+" : ""}
                  {portfolioReturn.toFixed(1)}%
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* vs Benchmark */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">vs Benchmark</CardTitle>
          </CardHeader>
          <CardContent>
            {!hasBenchmark || benchmarkReturn === null ? (
              <div className="text-sm text-slate-500">{missingMsg}</div>
            ) : (
              <div
                className={`text-2xl font-bold flex items-center space-x-2 ${getPerformanceColor(
                  portfolioReturn - benchmarkReturn,
                )}`}
              >
                {getPerformanceIcon(portfolioReturn - benchmarkReturn)}
                <span>
                  {portfolioReturn - benchmarkReturn > 0 ? "+" : ""}
                  {(portfolioReturn - benchmarkReturn).toFixed(1)}%
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Volatility */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">Volatility</CardTitle>
          </CardHeader>
          <CardContent>
            {!hasBenchmark ? (
              <div className="text-sm text-slate-500">{missingMsg}</div>
            ) : (
              <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{volatility.toFixed(1)}%</div>
            )}
          </CardContent>
        </Card>

        {/* Sharpe Ratio */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">Sharpe Ratio</CardTitle>
          </CardHeader>
          <CardContent>
            {!hasBenchmark ? (
              <div className="text-sm text-slate-500">{missingMsg}</div>
            ) : (
              <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{sharpeRatio.toFixed(2)}</div>
            )}
          </CardContent>
        </Card>

        {/* Max Drawdown */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">Max Drawdown</CardTitle>
          </CardHeader>
          <CardContent>
            {!hasBenchmark ? (
              <div className="text-sm text-slate-500">{missingMsg}</div>
            ) : (
              <div className={`text-2xl font-bold ${getPerformanceColor(maxDrawdown)}`}>{maxDrawdown.toFixed(1)}%</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="analysis" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="analysis">Analysis</TabsTrigger>
          <TabsTrigger value="holdings">Holdings</TabsTrigger>
          <TabsTrigger value="research">Research</TabsTrigger>
          <TabsTrigger value="report">
            <FileText className="w-4 h-4 mr-2" />
            Summary Report
          </TabsTrigger>
        </TabsList>

        <TabsContent value="analysis" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <TrendingUp className="w-5 h-5" />
                <span>Performance vs Benchmark</span>
              </CardTitle>
              <CardDescription>
                {hasBenchmark
                  ? `12-month portfolio performance vs ${benchmarkLabel}`
                  : "Add purchase price & date to compare vs benchmark"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {hasBenchmark ? (
                <PerformanceChart
                  data={portfolioData.performance}
                  hasBenchmark={portfolioData?.performanceMeta?.hasBenchmark}
                  benchmarkLabel={benchmarkLabel}
                />
              ) : (
                <div className="text-sm text-slate-500">{missingMsg}</div>
              )}
            </CardContent>
          </Card>

<div className="grid md:grid-cols-2 gap-6 items-start auto-rows-auto">
  {/* LEFT COLUMN: stack pie + tilts */}
  <div className="space-y-6">
    {/* Pie (fixed responsive height) */}
    <Card className="flex flex-col h-[240px] sm:h-[280px] md:h-[320px] lg:h-[380px]">
      <CardHeader className="pb-2">
        <CardTitle>Sector Allocation</CardTitle>
        <CardDescription>Current allocation vs selected benchmark</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden">
        {sectorsForChart.length ? (
          <div className="h-full">
            <AllocationChart data={sectorsForChart} />
          </div>
        ) : (
          <div className="text-sm text-slate-500">No funded sectors yet.</div>
        )}
      </CardContent>
    </Card>

<Card className="flex flex-col">
              <CardHeader>
    <CardTitle>Active Sector Tilts</CardTitle>
    <CardDescription>How you differ from {benchmarkLabel}</CardDescription>
  </CardHeader>
  <CardContent className="space-y-4">
    <div className="grid grid-cols-2 gap-4">
      <div>
        <div className="text-sm text-slate-600 dark:text-slate-400">Active Share</div>
        <div className="text-2xl font-bold">{activeSharePct}%</div>
      </div>
      <div>
        <div className="text-sm text-slate-600 dark:text-slate-400">Benchmark Match</div>
        <div className="text-2xl font-bold">
          {matchScore !== null ? `${matchScore}%` : "—"}
        </div>
      </div>
    </div>

    {topOver.length > 0 && (
      <div>
        <div className="text-sm font-medium mb-2">Top Overweights</div>
        <ul className="space-y-2">
          {topOver.map(s => (
            <li key={`over-${s.sector}`} className="flex items-center justify-between">
              <span className="text-sm">{s.sector}</span>
              <Badge className="bg-green-600 hover:bg-green-600 text-white">
                +{s.diff.toFixed(1)}%
              </Badge>
            </li>
          ))}
        </ul>
      </div>
    )}

    {topUnder.length > 0 && (
      <div>
        <div className="text-sm font-medium mb-2">Top Underweights</div>
        <ul className="space-y-2">
          {topUnder.map(s => (
            <li key={`under-${s.sector}`} className="flex items-center justify-between">
              <span className="text-sm">{s.sector}</span>
              <Badge variant="secondary" className="text-red-600 dark:text-red-400">
                {s.diff.toFixed(1)}%
              </Badge>
            </li>
          ))}
        </ul>
      </div>
    )}
  </CardContent>
              
            </Card>
</div>
{/* LEFT COLUMN (row 2): New “wow” card */}
  <Card className="flex flex-col row-span-2">
 <CardHeader>
                <CardTitle>Allocation Analysis</CardTitle>
                {/* UPDATED description */}
                <CardDescription>Sector allocation compared to benchmark weights</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {portfolioData.sectors.map((sector: any) => {
                  const difference = sector.allocation - sector.target; // target === benchmark now
                  return (
                    <div key={sector.sector} className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium">{sector.sector}</span>
                        <div className="flex items-center space-x-2">
                          <span className="text-sm text-slate-600 dark:text-slate-400">
                            {sector.allocation}% / {sector.target}%
                          </span>
                          <Badge variant={Math.abs(difference) <= 2 ? "default" : "secondary"}>
                            {difference > 0 ? "+" : ""}
                            {difference.toFixed(1)}%
                          </Badge>
                        </div>
                      </div>
                      <Progress
                        value={(sector.allocation / Math.max(sector.allocation, sector.target)) * 100}
                        className="h-2"
                      />
                    </div>
                  )
                })}
              </CardContent>
</Card>



          </div>

          <Card>
            <CardHeader>
              <CardTitle>Risk Analysis</CardTitle>
              <CardDescription>Rule-based concentration, diversification, and market risk</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <h4 className="font-medium text-slate-900 dark:text-slate-100">Concentration Risk</h4>
                  <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                    {portfolioData?.risk?.concentration?.level ?? "—"}
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Largest position: {portfolioData?.risk?.concentration?.largestPositionPct ?? "—"}% of portfolio
                  </p>
                </div>

                <div className="space-y-2">
                  <h4 className="font-medium text-slate-900 dark:text-slate-100">Diversification Score</h4>
                  <div className={`text-2xl font-bold ${diversificationColor(diversificationScore)}`}>
                    {typeof diversificationScore === "number" ? diversificationScore : "—"}/10
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    {portfolioData?.risk?.diversification?.holdings ?? "—"} holdings; top 2 ={" "}
                    {portfolioData?.risk?.diversification?.top2Pct ?? "—"}%
                  </p>
                </div>

                <div className="space-y-2">
  <h4 className="font-medium text-slate-900 dark:text-slate-100">Beta (Market Risk)</h4>

  {/* Portfolio Beta vs S&P 500 */}
  <div className="flex items-baseline justify-between">
    <div className="text-sm text-slate-600 dark:text-slate-400">Portfolio Beta</div>
    <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
      {typeof portfolioBetaSpx === "number" ? portfolioBetaSpx.toFixed(2) : "—"}
      <span className="text-base font-medium ml-2">
        {portfolioData?.risk?.beta?.level ?? ""}
      </span>
    </div>
  </div>

  <div className="flex items-baseline justify-between">
    <div className="text-sm text-slate-600 dark:text-slate-400">S&amp;P 500 Beta</div>
    <div className="text-xl font-semibold text-slate-900 dark:text-slate-100">
      {spxBeta.toFixed(2)}
    </div>
  </div>

  {typeof betaDiff === "number" && (
    <div className="pt-2 border-t mt-2 flex items-center justify-between">
      <div className="text-sm text-slate-600 dark:text-slate-400">Difference</div>
      <div
        className={`text-lg font-bold ${
          betaDiff > 0
            ? "text-red-600 dark:text-red-400"       // riskier than SPX
            : betaDiff < 0
            ? "text-green-600 dark:text-green-400"    // less risky than SPX
            : "text-slate-900 dark:text-slate-100"
        }`}
      >
        {betaDiff > 0 ? "+" : ""}
        {betaDiff.toFixed(2)}
      </div>
    </div>
  )}
  <p className="text-sm text-slate-600 dark:text-slate-400">
    Comparison is always vs S&amp;P 500 (^GSPC). Your performance benchmark selector does not change beta.
  </p>
</div>

              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ✅ FIXED: pass the portfolio ID string, not holdings array */}
        <TabsContent value="holdings">
          <HoldingsAnalysis portfolioId={portfolio.id} />
        </TabsContent>

        <TabsContent value="research">
          <NewsResearch portfolioId={portfolio.id} holdings={portfolio.portfolio_holdings} />
        </TabsContent>

        <TabsContent value="report">
          <PortfolioSummaryReport portfolio={portfolio} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
