"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LoadingButton } from "@/components/ui/loading-button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { FileDown } from "lucide-react"
import { withCsrfHeaders } from "@/lib/security/csrf-client"

type DataResponse = {
  holdings: Array<{
    id: string
    ticker: string
    price?: number
    shares: number
    weightPct: number
    returnSincePurchase: number | null
    contributionPct: number | null
    volatility12m: number | null
    beta12m: number | null
    sector?: string
  }>
  performance: Array<{ date: string; portfolio: number; benchmark?: number }>
  performanceMeta: { hasBenchmark: boolean; benchmark: string }
  sectors: Array<{ sector: string; allocation: number; target: number }>
  metrics: {
    portfolioReturn: number
    benchmarkReturn: number | null
    volatility: number
    sharpeRatio: number
    maxDrawdown: number
    beta: number
    totalValue: number
  }
  risk: {
    concentration: { level: string; largestPositionPct: number }
    diversification: { score: number; holdings: number; top2Pct: number }
    beta: { level: string; value: number }
  }
}

export function SummaryView({ portfolioId, portfolioName }: { portfolioId: string; portfolioName: string }) {
  const [data, setData] = useState<DataResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [isDownloading, setIsDownloading] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        setLoading(true)
        const dRes = await fetch(`/api/portfolio/${portfolioId}/data`)
        if (!dRes.ok) throw new Error("Failed to load portfolio data")
        const d = (await dRes.json()) as DataResponse
        if (!cancelled) {
          setData(d)
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load summary")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [portfolioId])

  const perf = data?.metrics
  const perfNarrative = useMemo(() => {
    if (!perf) return ""
    const y = perf.portfolioReturn
    const b = perf.benchmarkReturn
    const diff = typeof b === "number" ? (y - b).toFixed(1) : null
    return typeof b === "number"
      ? `Year-to-date, the portfolio returned ${y.toFixed(1)}%, versus ${b.toFixed(1)}% for the benchmark (${diff}pp relative). Volatility ${perf.volatility.toFixed(1)}% and Sharpe ${perf.sharpeRatio.toFixed(2)} reflect balanced risk taking. Max drawdown ${perf.maxDrawdown.toFixed(1)}%.`
      : `Year-to-date return is ${y.toFixed(1)}%. Volatility ${perf.volatility.toFixed(1)}% and Sharpe ${perf.sharpeRatio.toFixed(2)} reflect balanced risk taking. Max drawdown ${perf.maxDrawdown.toFixed(1)}%.`
  }, [perf])

  const handleDownload = async () => {
    try {
      setIsDownloading(true)
      const res = await fetch(`/api/portfolio/${portfolioId}/pdf`, withCsrfHeaders({ method: "POST" }))
      if (!res.ok) throw new Error("Failed to generate report")
      const { html, filename } = await res.json()
      const blob = new Blob([html], { type: "text/html;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename.replace(/\.pdf$/i, ".html")
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      // Optionally open in new tab for print->PDF
      // window.open(url, "_blank")
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to download report")
    } finally {
      setIsDownloading(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }
  if (err || !data) {
    return <div className="text-red-600 dark:text-red-400">{err || "Failed to load"}</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Monthly Portfolio Summary</h1>
          <p className="text-slate-600 dark:text-slate-400">{portfolioName}</p>
        </div>
        <LoadingButton
          onClick={handleDownload}
          loading={isDownloading}
          loadingText="Preparing report..."
          spinnerPlacement="start"
        >
          <FileDown className="w-4 h-4 mr-2" /> Download PDF
        </LoadingButton>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Executive Summary</CardTitle>
          <CardDescription>Objective, source-grounded overview of performance and positioning</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-700 dark:text-slate-300">{perfNarrative}</p>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Key Metrics</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Metric label="YTD Return" value={`${data.metrics.portfolioReturn.toFixed(1)}%`} />
            <Metric label="Benchmark" value={data.metrics.benchmarkReturn != null ? `${data.metrics.benchmarkReturn.toFixed(1)}%` : "N/A"} />
            <Metric label="Volatility" value={`${data.metrics.volatility.toFixed(1)}%`} />
            <Metric label="Sharpe" value={`${data.metrics.sharpeRatio.toFixed(2)}`} />
            <Metric label="Max DD" value={`${data.metrics.maxDrawdown.toFixed(1)}%`} />
            <Metric label="Beta" value={`${data.metrics.beta.toFixed(2)}`} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Allocation</CardTitle>
            <CardDescription>Current vs. targets</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.sectors.map((s) => (
              <div key={s.sector} className="flex items-center justify-between text-sm">
                <span>{s.sector}</span>
                <span>
                  {s.allocation}% / {s.target}% {Math.abs(s.allocation - s.target) <= 2 ? (
                    <Badge className="ml-2">on target</Badge>
                  ) : null}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Top Holdings</CardTitle>
          <CardDescription>Weights and contribution since purchase</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-2">Ticker</th>
                  <th className="py-2">Weight</th>
                  <th className="py-2">Shares</th>
                  <th className="py-2">Price</th>
                  <th className="py-2">Return</th>
                  <th className="py-2">Contribution</th>
                </tr>
              </thead>
              <tbody>
                {data.holdings.slice(0, 10).map((h) => (
                  <tr key={h.id} className="border-t border-slate-200 dark:border-slate-800">
                    <td className="py-2 font-medium">{h.ticker}</td>
                    <td className="py-2">{h.weightPct.toFixed(2)}%</td>
                    <td className="py-2">{h.shares.toFixed(2)}</td>
                    <td className="py-2">{typeof h.price === "number" ? `$${h.price.toFixed(2)}` : "N/A"}</td>
                    <td className="py-2">{h.returnSincePurchase != null ? `${h.returnSincePurchase.toFixed(2)}%` : "N/A"}</td>
                    <td className="py-2">{h.contributionPct != null ? `${h.contributionPct.toFixed(2)}%` : "N/A"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{value}</div>
    </div>
  )
}
