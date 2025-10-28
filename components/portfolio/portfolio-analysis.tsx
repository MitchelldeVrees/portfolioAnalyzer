"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowLeft, Edit3, TrendingUp, TrendingDown, Minus, FileText, RefreshCcw } from "lucide-react"
import Link from "next/link"
import { formatDistanceToNow } from "date-fns"
import { PerformanceChart } from "./performance-chart"
import { AllocationChart } from "./allocation-chart"
import { HoldingsAnalysis } from "./holdings-analysis"
import { PortfolioSummaryReport } from "./portfolio-summary-report"
import { PortfolioResearch } from "./portfolio-research"
import { useEffect, useState, useRef } from "react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
interface PortfolioHolding {
  id: string
  ticker: string
  weight: number
  shares?: number
  purchase_price?: number
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
  initialAnalysis?: any | null
  initialHoldings?: { holdings: any[]; meta: any } | null
}

export function PortfolioAnalysis({ portfolio, initialAnalysis = null, initialHoldings = null }: PortfolioAnalysisProps) {
  const [portfolioData, setPortfolioData] = useState<any>(initialAnalysis)
  const [benchmark, setBenchmark] = useState("^GSPC")
  const [loading, setLoading] = useState(!initialAnalysis)
  const [error, setError] = useState<string | null>(null)
  const [dataRefreshToken, setDataRefreshToken] = useState(0)
  const skipInitialFetchRef = useRef(!!initialAnalysis)
  const [refreshingData, setRefreshingData] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function fetchPortfolioData(silent: boolean) {
      try {
        if (!silent) setLoading(true)
        setError(null)
        const response = await fetch(`/api/portfolio/${portfolio.id}/data?benchmark=${encodeURIComponent(benchmark)}`)
        if (!response.ok) throw new Error("Failed to fetch portfolio data")
        const data = await response.json()
        if (!cancelled) setPortfolioData(data)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load data")
      } finally {
        if (!cancelled && !silent) setLoading(false)
      }
    }

    const hasExistingData = !!portfolioData
    const silent = (skipInitialFetchRef.current && dataRefreshToken === 0) || hasExistingData
    skipInitialFetchRef.current = false
    void fetchPortfolioData(silent)

    return () => {
      cancelled = true
    }
  }, [portfolio.id, benchmark, dataRefreshToken])

  const handleRefreshData = async () => {
    setRefreshError(null)
    setRefreshingData(true)
    try {
      const payload = JSON.stringify({ benchmark })

      const holdingsResponse = await fetch(`/api/portfolio/${portfolio.id}/holdings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      })
      if (!holdingsResponse.ok) {
        const errorBody = await holdingsResponse.json().catch(() => null)
        const message = errorBody?.error || `Failed to refresh holdings (${holdingsResponse.status})`
        throw new Error(message)
      }

      const analysisResponse = await fetch(`/api/portfolio/${portfolio.id}/data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      })
      if (!analysisResponse.ok) {
        const errorBody = await analysisResponse.json().catch(() => null)
        const message = errorBody?.error || `Failed to refresh analysis (${analysisResponse.status})`
        throw new Error(message)
      }

      setDataRefreshToken((token) => token + 1)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to refresh portfolio data"
      setRefreshError(message)
    } finally {
      setRefreshingData(false)
    }
  }



  useEffect(() => {
    if (initialAnalysis) {
      setPortfolioData(initialAnalysis)
      setLoading(false)
    }
  }, [initialAnalysis])

  const sortinoRatio: number = portfolioData?.metrics?.sortinoRatio ?? 0;

  const getRatioColor = (value: number) => {
  if (value > 2) return "text-green-600 dark:text-green-400"; // Good
  if (value > 1) return "text-amber-500 dark:text-amber-400"; // Moderate
  return "text-red-600 dark:text-red-400"; // Poor
};


  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Spinner className="mx-auto mb-4 text-blue-600" size="lg" />
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
  const missingMsg = "Add shares for all holdings to enable benchmark."

  const historicalPortfolioReturn: number = portfolioData?.metrics?.historicalPortfolioReturn ?? 0
  const portfolioReturn: number = hasBenchmark ? historicalPortfolioReturn : portfolioData?.metrics?.portfolioReturn ?? 0
  const benchmarkReturn: number | null = portfolioData?.metrics?.benchmarkReturn ?? null
  const volatility: number = portfolioData?.metrics?.volatility ?? 0
  const sharpeRatio: number = portfolioData?.metrics?.sharpeRatio ?? 0
  const maxDrawdown: number = portfolioData?.metrics?.maxDrawdown ?? 0
  const beta: number | undefined = portfolioData?.metrics?.beta

  const diversificationScore: number | undefined = portfolioData?.risk?.diversification?.score

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
    if (score <= 4) return "text-red-600 dark:text-red-400" // 0---Ã…â€œ4 --Ã‚Â -Ã¢â€žÂ¢ red
    if (score <= 6.5) return "text-amber-500 dark:text-amber-400" // 4.1---Ã…â€œ6.5 --Ã‚Â -Ã¢â€žÂ¢ yellow/orange
    return "text-green-600 dark:text-green-400" // >6.5 --Ã‚Â -Ã¢â€žÂ¢ green
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

  // Cosine similarity as a rough match score (0..100)
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

        <div className="flex flex-col items-end gap-2">
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
            <Button
              onClick={handleRefreshData}
              variant="default"
              disabled={refreshingData}
            >
              <RefreshCcw className={`w-4 h-4 mr-2 ${refreshingData ? "animate-spin" : ""}`} />
              {refreshingData ? "Refreshing..." : "Refresh Data"}
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/dashboard/portfolio/${portfolio.id}/edit`}>
                <Edit3 className="w-4 h-4 mr-2" />
                Edit Portfolio
              </Link>
            </Button>
          </div>
          {refreshError && (
            <p className="text-sm text-red-600 dark:text-red-400">{refreshError}</p>
          )}
          {portfolioData?.meta?.refreshedAt && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Last refreshed {formatDistanceToNow(new Date(portfolioData.meta.refreshedAt), { addSuffix: true })}
            </p>
          )}
        </div>
      </div>

      <TooltipProvider>
  <div className="grid md:grid-cols-5 gap-4">
    {/* Sharpe Ratio Card */}
    <Tooltip>
  <Card>
    <CardHeader className="pb-2">
      <TooltipTrigger asChild>
        <span>  {/* Add this span wrapper */}
          <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">Sharpe Ratio</CardTitle>
        </span>
      </TooltipTrigger>
    </CardHeader>
    <CardContent>
      {!hasBenchmark ? (
        <div className="text-sm text-slate-500">{missingMsg}</div>
      ) : (
        <div className={`text-2xl font-bold ${getRatioColor(sharpeRatio)}`}>
          {sharpeRatio.toFixed(2)}
        </div>
      )}
    </CardContent>
  </Card>
  <TooltipContent className="max-w-md">
    <p>The Sharpe Ratio measures risk-adjusted return by dividing excess return (over risk-free rate) by total volatility. It's important for comparing investments, showing efficiency per unit of risk-higher values indicate better performance relative to risk. Desired: 1 (good), 0.5-1 (moderate), 0.5 (poor).</p>
  </TooltipContent>
</Tooltip>

    {/* vs Benchmark */}
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">vs Benchmark(YTD)</CardTitle>
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

    {/* Sortino Ratio Card */}
    <Tooltip>
  <Card>
    <CardHeader className="pb-2">
      <TooltipTrigger asChild>
        <span>  {/* Add this span wrapper */}
          <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">Sortino Ratio</CardTitle>
        </span>
      </TooltipTrigger>
    </CardHeader>
    <CardContent>
      {!hasBenchmark ? (
        <div className="text-sm text-slate-500">{missingMsg}</div>
      ) : (
        <div className={`text-2xl font-bold ${getRatioColor(sortinoRatio)}`}>
          {sortinoRatio.toFixed(2)}
        </div>
      )}
    </CardContent>
  </Card>
  <TooltipContent className="max-w-md">
    <p>The Sortino Ratio refines Sharpe by focusing only on downside volatility (negative returns). It's crucial for risk-averse investors as it penalizes only harmful risk, making it ideal for volatile assets. Desired: 1.5 (good), 0.8-2.0 typical, often higher than Sharpe.</p>
  </TooltipContent>
</Tooltip>
  </div>
</TooltipProvider>

      <Tabs defaultValue="analysis" className="space-y-6" key={benchmark}>
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
                        {matchScore !== null ? `${matchScore}%` : "-"}
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
            {/* LEFT COLUMN (row 2): Allocation Analysis card */}
            <Card className="flex flex-col row-span-2">
              <CardHeader>
                <CardTitle>Allocation Analysis</CardTitle>
                <CardDescription>Sector allocation compared to benchmark weights</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {portfolioData.sectors.map((sector: any) => {
                  const difference = sector.allocation - sector.target;
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
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <h4 className="font-medium text-slate-900 dark:text-slate-100">Concentration Risk</h4>
                  <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                    {portfolioData?.risk?.concentration?.level ?? "-"}
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Largest position: {portfolioData?.risk?.concentration?.largestPositionPct ?? "-"}% of portfolio
                  </p>
                </div>

                <div className="space-y-2">
                  <h4 className="font-medium text-slate-900 dark:text-slate-100">Diversification Score</h4>
                  <div className={`text-2xl font-bold ${diversificationColor(diversificationScore)}`}>
                    {typeof diversificationScore === "number" ? diversificationScore : "-"}/10
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    {portfolioData?.risk?.diversification?.holdings ?? "-"} holdings; top 2 ={" "}
                    {portfolioData?.risk?.diversification?.top2Pct ?? "-"}%
                  </p>
                </div>

                <div className="space-y-2">
                  <h4 className="font-medium text-slate-900 dark:text-slate-100">Beta (Market Risk)</h4>
                  <div className="flex items-baseline justify-between">
                    <div className="text-sm text-slate-600 dark:text-slate-400">Portfolio Beta</div>
                    <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                      {typeof portfolioBetaSpx === "number" ? portfolioBetaSpx.toFixed(2) : "-"}
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
                            ? "text-red-600 dark:text-red-400"
                            : betaDiff < 0
                            ? "text-green-600 dark:text-green-400"
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

        <TabsContent value="holdings">
          <HoldingsAnalysis portfolioId={portfolio.id} benchmark={benchmark} refreshToken={dataRefreshToken} initialData={initialHoldings} />
        </TabsContent>

        <TabsContent value="research">
          <PortfolioResearch portfolioId={portfolio.id} />
        </TabsContent>

        <TabsContent value="report">
          <PortfolioSummaryReport portfolio={portfolio} benchmark={benchmark} />
        </TabsContent>
      </Tabs>
      {refreshingData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm">
          <Card className="w-[320px] shadow-xl">
            <CardContent className="py-8 text-center space-y-4">
              <Spinner className="mx-auto text-blue-600" size="lg" />
              <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Refreshing portfolio data
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                We are fetching the latest market data. This might take a moment.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}












