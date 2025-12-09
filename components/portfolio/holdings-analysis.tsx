// /app/(whatever)/holding-analysis.tsx
"use client"

import { useEffect, useMemo, useState, useRef } from "react"
import { formatDistanceToNow } from "date-fns"
import { motion, AnimatePresence } from "framer-motion"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { TrendingUp, TrendingDown, Minus, Info } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"

const currencySymbols: Record<string, string> = {
  USD: "$",
}

const formatCurrencyValue = (value: number, currency: string) => {
  const symbol = currencySymbols["USD"] // force USD display
  return symbol ? `${symbol}${value.toFixed(2)}` : `${currency} ${value.toFixed(2)}`
}

type RiskComponent = {
  key: string
  label: string
  score: number // 0..100 (higher = riskier)
  weight: number // 0..1
  value: number | null // raw value as returned by the API
}

type HoldingRow = {
  id: string
  ticker: string
  quoteSymbol?: string
  priceCurrency?: string
  localCurrency?: string
  sector: string
  price: number
  weightPct: number
  shares: number
  hasCostBasis: boolean
  returnSincePurchase: number | null
  contributionPct: number | null
  volatility12m: number | null
  beta12m: number | null
  // NEW robust risk fields from the API:
  riskScore?: number | null
  riskBucket?: "Low" | "Medium" | "High" | "-"
  riskComponents?: RiskComponent[]
}

interface HoldingsAnalysisProps {
  portfolioId: string
  benchmark: string
  refreshToken: number
  initialData?: { holdings: HoldingRow[]; meta: any } | null
}

export function HoldingsAnalysis({ portfolioId, benchmark, refreshToken, initialData = null }: HoldingsAnalysisProps) {
  const [data, setData] = useState<{ holdings: HoldingRow[]; meta: any } | null>(initialData)
  const [loading, setLoading] = useState(!initialData)
  const [error, setError] = useState<string | null>(null)
  const skipInitialFetchRef = useRef(!!initialData)
  // modal state
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<HoldingRow | null>(null)

  useEffect(() => {
    let cancelled = false

    async function run(silent: boolean) {
      try {
        if (!silent) setLoading(true)
        setError(null)
        const res = await fetch(`/api/portfolio/${portfolioId}/holdings?benchmark=${encodeURIComponent(benchmark)}`)
        if (!res.ok) throw new Error(`Failed to load holdings (${res.status})`)
        const json = await res.json()
        if (!cancelled) setData(json)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load holdings")
      } finally {
        if (!cancelled && !silent) setLoading(false)
      }
    }

    const hasExisting = !!data
    const silent = skipInitialFetchRef.current || hasExisting
    if (silent && skipInitialFetchRef.current) {
      skipInitialFetchRef.current = false
      void run(true)
    } else if (silent) {
      void run(true)
    } else {
      void run(false)
    }

    return () => {
      cancelled = true
    }
  }, [portfolioId, benchmark, refreshToken])


  useEffect(() => {
    if (initialData) {
      setData(initialData)
      setLoading(false)
    }
  }, [initialData])

  const anyCostBasis = !!data?.meta?.anyCostBasis
  const holdings = data?.holdings || []
  const baseCurrency = "USD"

  const refreshSnapshot = async (force = false) => {
    const url = `/api/portfolio/${portfolioId}/holdings?benchmark=${encodeURIComponent(benchmark)}${force ? "&forceRefresh=true" : ""}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to load holdings (${res.status})`)
    const json = await res.json()
    setData(json)
  }

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

  const formatNumber = (value: number | null | undefined, decimals = 2) => {
    if (typeof value !== "number" || Number.isNaN(value)) return "-"
    return value.toFixed(decimals)
  }

  // Use composite risk score buckets
  const getRiskLevel = (riskScore?: number | null) => {
    const v = typeof riskScore === "number" ? riskScore : null
    if (v === null) return { level: "-", color: "bg-slate-400" }
    if (v < 33) return { level: "Low", color: "bg-green-500" }
    if (v < 66) return { level: "Medium", color: "bg-amber-500" }
    return { level: "High", color: "bg-red-500" }
  }

  const summary = useMemo(() => {
    if (!holdings.length) return null
    const withReturns = holdings.filter(h => typeof h.returnSincePurchase === "number")
    const topPerformer = withReturns.length
      ? withReturns.reduce((best, h) =>
          (h.returnSincePurchase as number) > (best.returnSincePurchase as number) ? h : best,
        )
      : holdings[0]
    const largestContributor = holdings.filter(h => typeof h.contributionPct === "number").length
      ? holdings.reduce((best, h) =>
          (h.contributionPct || -Infinity) > (best.contributionPct || -Infinity) ? h : best,
        )
      : holdings[0]
    const mostVolatile = holdings.reduce((best, h) =>
      (h.volatility12m || -Infinity) > (best.volatility12m || -Infinity) ? h : best,
    )
    const avgBetaWeighted = data?.meta?.avgBetaWeighted ?? 0
    return { topPerformer, largestContributor, mostVolatile, avgBetaWeighted }
  }, [holdings, data?.meta?.avgBetaWeighted])

  // ---------- UI ----------
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Individual Holdings Analysis</CardTitle>
          <CardDescription>Loading holdings...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-24 flex items-center text-slate-500 dark:text-slate-400">Fetching data...</div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Individual Holdings Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-red-600 dark:text-red-400">Error: {error}</div>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <CardTitle>Individual Holdings Analysis</CardTitle>
            <CardDescription>
              {anyCostBasis
                ? `Performance, contribution, and risk by holding (vs ${data?.meta?.benchmark})`
                : "No purchase data found - showing current allocation and risk only"}
            </CardDescription>
            {data?.meta?.refreshedAt && (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Refreshed {formatDistanceToNow(new Date(data.meta.refreshedAt), { addSuffix: true })}
              </p>
            )}
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              All values converted to {baseCurrency}.
            </p>
          </div>
          
        </CardHeader>

        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-3 font-medium text-slate-600 dark:text-slate-400">Ticker</th>
                  <th className="text-left p-3 font-medium text-slate-600 dark:text-slate-400">Sector</th>
                  <th className="text-left p-3 font-medium text-slate-600 dark:text-slate-400">Price</th>
                  <th className="text-left p-3 font-medium text-slate-600 dark:text-slate-400">Weight</th>
                  {anyCostBasis && (
                    <>
                      <th className="text-left p-3 font-medium text-slate-600 dark:text-slate-400">Return</th>
                      <th className="text-left p-3 font-medium text-slate-600 dark:text-slate-400">Contribution</th>
                    </>
                  )}
                  <th className="text-left p-3 font-medium text-slate-600 dark:text-slate-400">Volatility</th>
                  <th className="text-left p-3 font-medium text-slate-600 dark:text-slate-400">Beta</th>
                  <th className="text-left p-3 font-medium text-slate-600 dark:text-slate-400">Risk Score</th>
                  <th className="text-left p-3 font-medium text-slate-600 dark:text-slate-400">Risk</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => {
                  const risk = getRiskLevel(h.riskScore)
                  const canExplain = typeof h.riskScore === "number" && (h.riskComponents?.length ?? 0) > 0
                  return (
                    <tr key={h.id} className="border-b hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="p-3">
                        <div className="flex flex-col gap-1">
                          <div className="font-mono font-medium text-slate-900 dark:text-slate-100">{h.ticker}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">Quote: {h.quoteSymbol ?? h.ticker}</div>
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="text-slate-900 dark:text-slate-100">{h.sector}</div>
                      </td>
                      <td className="p-3">
                        <div className="text-slate-900 dark:text-slate-100">
                          {typeof h.price === "number"
                            ? formatCurrencyValue(h.price, h.priceCurrency || baseCurrency)
                            : "-"}
                        </div>
                        {h.localCurrency && h.localCurrency !== baseCurrency && (
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            FX {h.localCurrency} → {baseCurrency}
                          </p>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="space-y-1">
                          <div className="text-slate-900 dark:text-slate-100 font-medium">{h.weightPct.toFixed(1)}%</div>
                          <Progress value={h.weightPct} className="h-1 w-20" />
                        </div>
                      </td>

                      {anyCostBasis && (
                        <>
                          <td className="p-3">
                            {typeof h.returnSincePurchase === "number" ? (
                              <div className={`flex items-center space-x-1 font-medium ${getPerformanceColor(h.returnSincePurchase)}`}>
                                {getPerformanceIcon(h.returnSincePurchase)}
                                <span>
                                  {h.returnSincePurchase > 0 ? "+" : ""}
                                  {h.returnSincePurchase.toFixed(1)}%
                                </span>
                              </div>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>
                          <td className="p-3">
                            {typeof h.contributionPct === "number" ? (
                              <div className={`font-medium ${getPerformanceColor(h.contributionPct)}`}>
                                {h.contributionPct > 0 ? "+" : ""}
                                {h.contributionPct.toFixed(1)}%
                              </div>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>
                        </>
                      )}

                      <td className="p-3">
                        <div className="text-slate-900 dark:text-slate-100">
                          {typeof h.volatility12m === "number" ? `${h.volatility12m.toFixed(1)}%` : "-"}
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="text-slate-900 dark:text-slate-100">
                          {typeof h.beta12m === "number" ? h.beta12m.toFixed(2) : "-"}
                        </div>
                      </td>

                      {/* Risk Score (click to explain) */}
                      <td className="p-3">
                        {typeof h.riskScore === "number" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="px-2 font-mono"
                            onClick={() => { setSelected(h); setOpen(true) }}
                          >
                            {h.riskScore}
                            <Info className="w-3.5 h-3.5 ml-1 opacity-70" />
                          </Button>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>

                      {/* Risk bucket badge */}
                      <td className="p-3">
                        <Badge
                          variant="outline"
                          className={`text-xs cursor-${canExplain ? "pointer" : "default"}`}
                          onClick={() => { if (canExplain) { setSelected(h); setOpen(true) } }}
                          title={canExplain ? "Click to see how this was calculated" : ""}
                        >
                          <div className={`w-2 h-2 rounded-full ${risk.color} mr-1`} />
                          {risk.level}
                        </Badge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Summary Stats */}
          {summary && (
            <div className="mt-6 grid md:grid-cols-4 gap-4 pt-4 border-t">
              <div className="text-center">
                <div className="text-sm text-slate-600 dark:text-slate-400">Top Performer</div>
                <div className="font-bold text-green-600 dark:text-green-400">{summary.topPerformer.ticker}</div>
              </div>
              <div className="text-center">
                <div className="text-sm text-slate-600 dark:text-slate-400">Largest Contributor</div>
                <div className="font-bold text-blue-600 dark:text-blue-400">{summary.largestContributor.ticker}</div>
              </div>
              <div className="text-center">
                <div className="text-sm text-slate-600 dark:text-slate-400">Most Volatile</div>
                <div className="font-bold text-red-600 dark:text-red-400">{summary.mostVolatile.ticker}</div>
              </div>
              <div className="text-center">
                <div className="text-sm text-slate-600 dark:text-slate-400">Avg Beta (weighted)</div>
                <div className="font-bold text-slate-900 dark:text-slate-100">{summary.avgBetaWeighted.toFixed(2)}</div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Animated Risk Explainer Modal */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl p-0 overflow-hidden">
          <AnimatePresence mode="wait">
            {open && selected && (
              <motion.div
                key={selected.id}
                initial={{ opacity: 0, y: 20, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 300, damping: 25, mass: 0.6 }}
                className="w-full"
              >
                <DialogHeader className="px-6 pt-6">
                  <DialogTitle className="flex items-center justify-between">
                    <span>
                      {selected.ticker} - Risk score{" "}
                      <span className="font-mono">{formatNumber(selected.riskScore)}</span>
                    </span>
                    <Badge variant="outline" className="ml-3">
                      {getRiskLevel(selected.riskScore).level}
                    </Badge>
                  </DialogTitle>
                  <DialogDescription className="mt-1">
                    Your risk score is a weighted blend of market risk, balance sheet, valuation, liquidity,
                    short interest, and event proximity. Higher factor scores = riskier. Weights are shown below.
                  </DialogDescription>
                </DialogHeader>

                <ScrollArea className="h-[60vh] px-6 pb-6">
                  {/* Formula card */}
                  <div className="mt-4 rounded-2xl border p-4 bg-slate-50 dark:bg-slate-900/40">
                    <div className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                      Formula (weights x scores -> 0-100):
                    </div>
                    <div className="font-mono text-sm">
                      riskScore = Sigma (component.score x component.weight)
                    </div>
                  </div>

                  {/* Components list */}
                  <div className="mt-6 space-y-4">
                    {(selected.riskComponents ?? [])
                      .slice()
                      .sort((a, b) => (b.score * b.weight) - (a.score * a.weight))
                      .map((c) => {
                        const impact = Math.round(c.score * c.weight * 100) / 100 // 0..100 weighted contribution
                        return (
                          <div key={c.key} className="rounded-xl border p-4">
                            <div className="flex items-center justify-between">
                              <div className="font-medium">{c.label}</div>
                              <div className="text-sm text-slate-600 dark:text-slate-400">
                                weight {(c.weight * 100).toFixed(0)}%
                              </div>
                            </div>

                            <div className="mt-2 grid gap-2 md:grid-cols-3">
                              <div className="col-span-2">
                                <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                                  <span>score {formatNumber(c.score)}</span>
                                  <span>impact {formatNumber(impact)}</span>
                                </div>
                                <div className="mt-1 h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                                  <motion.div
                                    className="h-2 rounded-full bg-slate-900 dark:bg-slate-100"
                                    initial={{ width: 0 }}
                                    animate={{ width: `${c.score}%` }}
                                    transition={{ type: "spring", stiffness: 180, damping: 20 }}
                                  />
                                </div>
                              </div>
                              <div className="text-xs md:text-right text-slate-600 dark:text-slate-400">
                                raw value:&nbsp;
                                <span className="font-mono text-slate-900 dark:text-slate-100">
                                  {typeof c.value === "number" ? formatNumber(c.value) : c.value ?? "-"}
                                </span>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                  </div>

                  {/* Totals */}
                  <div className="mt-6 rounded-2xl border p-4 bg-slate-50 dark:bg-slate-900/40">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-slate-600 dark:text-slate-400">Total</div>
                      <div className="font-bold text-lg font-mono">{formatNumber(selected.riskScore)}</div>
                    </div>
                  </div>
                </ScrollArea>
              </motion.div>
            )}
          </AnimatePresence>
        </DialogContent>
      </Dialog>
    </>
  )
}
