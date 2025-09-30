"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  FileText,
  Download,
  Mail,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  Target,
  BarChart3,
  Calendar,
  Loader2,
  Info,
} from "lucide-react"
import { format } from "date-fns"

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

interface PortfolioSummaryReportProps {
  portfolio: Portfolio | null | undefined
    benchmark?: string

}

/** API response from /api/portfolio/[id]/summary */
type SummaryResp = {
  overall: {
    score: number
    components: Array<{
      key: string
      label: string
      weight: number
      score: number
      scorePct: number
      contribution: number
      rationale: string[]
    }>
    drivers: { positives: string[]; negatives: string[] }
  }
  summaryMetrics: {
    totalReturnPct: number | null
    holdingsCount: number
    sharpeRatio: number | null
    hasMeaningfulCostBasis: boolean
  }
}

interface ReportSection {
  title: string
  status: "excellent" | "good" | "needs_attention" | "poor"
  score: number
  summary: string
  recommendations: string[]
  keyMetrics: Array<{ label: string; value: string; trend?: "up" | "down" | "neutral" }>
}

export function PortfolioSummaryReport({ portfolio,benchmark = "^GSPC"  }: PortfolioSummaryReportProps) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [isEmailing, setIsEmailing] = useState(false)
  const [today, setToday] = useState<string>("")
  const [summary, setSummary] = useState<SummaryResp | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setToday(format(new Date(), "MMMM d, yyyy"))
  }, [])

  // Fetch score + KPIs from new summary route
  useEffect(() => {
    let cancelled = false
    async function run() {
      if (!portfolio?.id) return
      try {
        setError(null)
        const res = await fetch(`/api/portfolio/${portfolio.id}/summary`, { cache: "no-store" })
        if (!res.ok) throw new Error(`Failed to load summary (${res.status})`)
        const json = (await res.json()) as SummaryResp
        if (!cancelled) setSummary(json)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load summary")
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [portfolio?.id])

  // Keep your existing sections for now (can later be wired to the summary payload if desired)
  const holdingsCountStatic = portfolio?.portfolio_holdings?.length ?? 0
  const reportData: ReportSection[] = useMemo(
    () => [
      {
        title: "Performance Overview",
        status: "excellent",
        score: 92,
        summary:
          "Your portfolio has significantly outperformed the market benchmark with a 24.3% return vs 17.2% for the S&P 500. Strong risk-adjusted returns with a Sharpe ratio of 1.42 indicate efficient risk management.",
        recommendations: [
          "Continue current strategy as performance metrics are strong",
          "Consider taking some profits in top performers to rebalance",
          "Monitor volatility as it's slightly above target range",
        ],
        keyMetrics: [
          { label: "Total Return", value: "+24.3%", trend: "up" },
          { label: "vs Benchmark", value: "+7.1%", trend: "up" },
          { label: "Sharpe Ratio", value: "1.42", trend: "up" },
          { label: "Max Drawdown", value: "-8.5%", trend: "neutral" },
        ],
      },
      {
        title: "Asset Allocation",
        status: "good",
        score: 78,
        summary:
          "Portfolio shows good diversification across sectors with technology allocation at 35%. Healthcare is underweight at 15% vs target of 20%. Geographic diversification could be improved with more international exposure.",
        recommendations: [
          "Reduce technology allocation from 35% to 30% to manage concentration risk",
          "Increase healthcare allocation to 20% through JNJ, PFE, or healthcare ETFs",
          "Add 10-15% international exposure for better diversification",
          "Consider adding REITs for inflation protection",
        ],
        keyMetrics: [
          { label: "Sector Diversification", value: "7 sectors", trend: "neutral" },
          { label: "Top 5 Concentration", value: "45%", trend: "neutral" },
          { label: "International Exposure", value: "5%", trend: "down" },
          { label: "Cash Position", value: "2%", trend: "neutral" },
        ],
      },
      {
        title: "Individual Holdings",
        status: "good",
        score: 85,
        summary:
          "Strong performance from NVDA (+45.7%) and AAPL (+28.5%) driving portfolio returns. TSLA showing weakness (-12.3%) due to production challenges. Overall holdings quality is high with established companies.",
        recommendations: [
          "Trim NVDA position and take profits after strong run",
          "Reduce TSLA allocation from 8% to 5% due to production risks",
          "Add defensive positions in utilities or consumer staples",
          "Consider adding dividend-paying stocks for income",
        ],
        keyMetrics: [
          { label: "Top Performer", value: "NVDA +45.7%", trend: "up" },
          { label: "Worst Performer", value: "TSLA -12.3%", trend: "down" },
          { label: "Avg Beta", value: "1.08", trend: "neutral" },
          { label: "Holdings Count", value: String(holdingsCountStatic), trend: "neutral" },
        ],
      },
      {
        title: "Risk Analysis",
        status: "good",
        score: 82,
        summary:
          "Portfolio exhibits moderate risk with beta of 1.08. Concentration risk is well-managed with no single holding exceeding 15%. Volatility at 12.8% is within acceptable range for growth-oriented portfolio.",
        recommendations: [
          "Maintain current risk level as it aligns with growth objectives",
          "Consider adding low-correlation assets to reduce overall volatility",
          "Monitor technology sector concentration during market stress",
          "Implement stop-loss orders on high-beta positions",
        ],
        keyMetrics: [
          { label: "Portfolio Beta", value: "1.08", trend: "neutral" },
          { label: "Volatility", value: "12.8%", trend: "neutral" },
          { label: "VaR (95%)", value: "-2.1%", trend: "neutral" },
          { label: "Correlation to S&P", value: "0.89", trend: "neutral" },
        ],
      },
    ],
    [holdingsCountStatic]
  )

  // UI helpers
  const getStatusColor = (status: string) => {
    switch (status) {
      case "excellent":
        return "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
      case "good":
        return "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800"
      case "needs_attention":
        return "text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800"
      case "poor":
        return "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
      default:
        return "text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/20 border-slate-200 dark:border-slate-800"
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "excellent":
        return <CheckCircle2 className="w-5 h-5 text-green-600" />
      case "good":
        return <TrendingUp className="w-5 h-5 text-blue-600" />
      case "needs_attention":
        return <AlertTriangle className="w-5 h-5 text-yellow-600" />
      case "poor":
        return <TrendingDown className="w-5 h-5 text-red-600" />
      default:
        return <BarChart3 className="w-5 h-5 text-slate-600" />
    }
  }

  const getTrendIcon = (trend?: string) => {
    switch (trend) {
      case "up":
        return <TrendingUp className="w-4 h-4 text-green-600" />
      case "down":
        return <TrendingDown className="w-4 h-4 text-red-600" />
      default:
        return null
    }
  }

  const handleExportPDF = async () => {
    if (!portfolio?.id) {
      alert("Portfolio is not loaded yet.")
      return
    }
    setIsGenerating(true)
    try {
      const response = await fetch(`/api/portfolio/${portfolio.id}/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ benchmark }),
      })
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}))
        throw new Error(errBody?.error || `Failed to generate PDF (status ${response.status})`)
      }
      const { html } = await response.json()
      if (!html) throw new Error("PDF HTML was not returned by the API")

      const iframe = document.createElement("iframe")
      iframe.style.position = "fixed"
      iframe.style.right = "0"
      iframe.style.bottom = "0"
      iframe.style.width = "0"
      iframe.style.height = "0"
      iframe.style.border = "0"
      document.body.appendChild(iframe)

      const doc = iframe.contentDocument || iframe.contentWindow?.document
      if (!doc) throw new Error("Failed to access iframe document")

      doc.open()
      doc.write(html)
      doc.close()

      setTimeout(() => {
        iframe.contentWindow?.focus()
        iframe.contentWindow?.print()
        setTimeout(() => document.body.removeChild(iframe), 500)
      }, 300)
    } catch (e) {
      console.error(e)
      alert(e instanceof Error ? e.message : "Failed to generate PDF report.")
    } finally {
      setIsGenerating(false)
    }
  }

  const handleEmailReport = async () => {
    setIsEmailing(true)
    try {
      const email = prompt("Enter email address to send the report:")
      if (email) {
        await new Promise((resolve) => setTimeout(resolve, 1200))
        alert(`Professional portfolio report has been sent to ${email}`)
      }
    } catch (error) {
      console.error("Error sending email:", error)
      alert("Failed to send email. Please try again.")
    } finally {
      setIsEmailing(false)
    }
  }

  if (!portfolio) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Loading portfolio…</CardTitle>
          <CardDescription>Please wait while we fetch your data.</CardDescription>
        </CardHeader>
        <CardContent>
          <Progress value={30} className="w-full h-2" />
        </CardContent>
      </Card>
    )
  }

  const holdingsCount = summary?.summaryMetrics.holdingsCount ?? holdingsCountStatic
  const sharpe = summary?.summaryMetrics.sharpeRatio ?? null
  const totalReturnPct = summary?.summaryMetrics.totalReturnPct

  return (
    <div className="space-y-6">
      {/* Report Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl flex items-center justify-center shadow-lg">
                <FileText className="w-6 h-6 text-white" />
              </div>
              <div>
                <CardTitle className="text-2xl">Professional Portfolio Analysis Report</CardTitle>
                <CardDescription className="text-base">
                  Comprehensive analysis for {portfolio.name} • Generated on {today || "…"}
                </CardDescription>
              </div>
            </div>
            <div className="flex space-x-2">
              
              <Button onClick={handleExportPDF} disabled={isGenerating || isEmailing}>
                {isGenerating ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Download className="w-4 h-4 mr-2" />
                )}
                {isGenerating ? "Generating..." : "Export Professional PDF"}
              </Button>
            </div>
          </div>
        </CardHeader>

        {/* KPI row (dynamic) */}
        <CardContent>
          {error && <div className="text-red-600 dark:text-red-400 mb-4">Error: {error}</div>}
          <div className="grid md:grid-cols-4 gap-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-1">
                {summary ? summary.overall.score : "…"} / 100
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-400">Overall Score</div>
            </div>

            {/* Total Return: only when cost basis is meaningful */}
            {totalReturnPct != null ? (
              <div className="text-center">
                <div className="text-3xl font-bold text-green-600 dark:text-green-400 mb-1">
                  {totalReturnPct > 0 ? "+" : ""}
                  {totalReturnPct.toFixed(1)}%
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-400">Total Return (since purchase)</div>
              </div>
            ) : (
              <div className="text-center">
                <div className="text-3xl font-bold text-slate-400 mb-1">—</div>
                <div className="text-sm text-slate-500 dark:text-slate-400">Total Return unavailable</div>
              </div>
            )}

            <div className="text-center">
              <div className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-1">{holdingsCount}</div>
              <div className="text-sm text-slate-600 dark:text-slate-400">Holdings</div>
            </div>

            <div className="text-center">
              <div className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-1">
                {sharpe != null ? sharpe.toFixed(2) : "—"}
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-400">Sharpe Ratio</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Professional Report Preview Notice */}
      <Card className="border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20">
        <CardContent className="pt-6">
          <div className="flex items-start space-x-3">
            <Info className="w-5 h-5 text-blue-600 mt-0.5" />
            <div>
              <h4 className="font-semibold text-blue-900 dark:text-blue-100 mb-1">Professional Report Generation</h4>
              <p className="text-sm text-blue-800 dark:text-blue-200">
                The PDF export generates a professional-grade report styled after major investment banks like J.P.
                Morgan, ING, and Barclays research reports. It includes comprehensive analysis, charts, and actionable
                recommendations suitable for client presentations.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      

      {/* Disclaimer */}
      
    </div>
  )
}
