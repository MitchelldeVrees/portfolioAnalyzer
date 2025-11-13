"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { formatDistanceToNow } from "date-fns"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { Progress } from "@/components/ui/progress"
import { RefreshCcw } from "lucide-react"
import { withCsrfHeaders } from "@/lib/security/csrf-client"

const RESEARCH_DISABLED = (process.env.NEXT_PUBLIC_DISABLE_PORTFOLIO_RESEARCH ?? "1") !== "0"

type ResearchResponse = {
  result: string
  tickers: string[]
  generatedAt?: string | null
  insights?: Array<{
    ticker: string
    overview?: Record<string, any> | null
    price?: Record<string, any> | null
    earnings?: Record<string, any> | null
    earningsCall?: Record<string, any> | null
    insiders?: Array<Record<string, any>>
  }>
  stories?: Array<{
    ticker: string
    summary: string
  }>
  warning?: string
  meta?: {
    model?: string
    lookbackDays?: number
    tickerCount?: number
    status?: string
  }
}

type PortfolioResearchProps = {
  portfolioId: string
}

type InsightEntry = ResearchResponse["insights"] extends Array<infer T> ? T : never

export function PortfolioResearch({ portfolioId }: PortfolioResearchProps) {
  if (RESEARCH_DISABLED) {
    return (
      <Card className="relative overflow-hidden border-dashed border-slate-300 dark:border-slate-700">
        <div className="absolute inset-0 bg-slate-900/70 backdrop-blur flex items-center justify-center px-6 text-center">
          <div className="space-y-2">
            <p className="text-lg font-semibold text-white">We are still working on this segment.</p>
            <p className="text-sm text-slate-200">
              The AI research experience is paused across all environments while we finalize improvements.
            </p>
          </div>
        </div>
        <CardHeader>
          <CardTitle>AI Research</CardTitle>
          <CardDescription>Experimental research insights will appear here once this feature returns.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="h-32 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
          <div className="h-20 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
          <div className="h-20 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
        </CardContent>
      </Card>
    )
  }
  const [data, setData] = useState<ResearchResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progressTotal, setProgressTotal] = useState(0)
  const [progressCount, setProgressCount] = useState(0)

  const loadResearch = useCallback(
    async (opts?: { force?: boolean }) => {
      try {
        setError(null)
        if (opts?.force) {
          setIsRefreshing(true)
          setProgressTotal(data?.tickers?.length ?? progressTotal)
          setProgressCount(0)
        } else {
          setIsLoading(true)
        }
        const res = await fetch(
          `/api/portfolio/${portfolioId}/research`,
          opts?.force
            ? withCsrfHeaders({ method: "POST", headers: { "Content-Type": "application/json" } })
            : { method: "GET", headers: { "Content-Type": "application/json" } },
        )
        if (!res.ok) {
          const payload = await res.json().catch(() => null)
          const message =
            typeof payload?.error === "string" && payload.error.length > 0
              ? payload.error
              : `Request failed (${res.status})`
          throw new Error(message)
        }
        const json = (await res.json()) as ResearchResponse
        setData(json)
        const total = json?.tickers?.length ?? json?.stories?.length ?? 0
        setProgressTotal(total)
        setProgressCount(total === 0 ? 0 : 0)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load research"
        setError(message)
        setData(null)
        setProgressCount(0)
      } finally {
        setIsLoading(false)
        setIsRefreshing(false)
      }
    },
    [portfolioId, data?.tickers?.length, progressTotal],
  )

  useEffect(() => {
    loadResearch().catch(() => {
      // handled in loadResearch
    })
  }, [loadResearch])

  useEffect(() => {
    if (!data) return
    const total = data.tickers?.length ?? data.stories?.length ?? 0
    setProgressTotal(total)
    setProgressCount(total === 0 ? 0 : Math.min(progressCount, total))
  }, [data])

  const stories = useMemo(() => {
    if (Array.isArray(data?.stories) && data.stories.length > 0) {
      return data.stories
    }
    if (data?.result?.trim().length) {
      return [
        {
          ticker: data.tickers?.[0] ?? "Summary",
          summary: data.result,
        },
      ]
    }
    return []
  }, [data])

  const insightsByTicker = useMemo(() => {
    const map = new Map<string, InsightEntry>()
    if (Array.isArray(data?.insights)) {
      data.insights.forEach((insight) => {
        if (insight?.ticker) {
          map.set(insight.ticker, insight)
        }
      })
    }
    return map
  }, [data?.insights])

  useEffect(() => {
    if (!stories.length || isLoading) return
    let cancelled = false
    setProgressCount(stories.length > 0 ? 0 : 0)
    const timers = stories.map((_, idx) =>
      window.setTimeout(() => {
        if (!cancelled) {
          setProgressCount((prev) => Math.min(prev + 1, stories.length))
        }
      }, 200 * (idx + 1)),
    )
    return () => {
      cancelled = true
      timers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [stories, isLoading])

  const generatedAt = useMemo(() => {
    if (!data?.generatedAt) return null
    try {
      return new Date(data.generatedAt)
    } catch {
      return null
    }
  }, [data?.generatedAt])

  const tickers = data?.tickers ?? []
  const resultText = data?.result ?? ""
  const modelName = data?.meta?.model
  const lookbackDays = data?.meta?.lookbackDays
  const warningText = data?.warning ?? (typeof data?.meta?.status === "string" ? data.meta.status : null)
  const visibleStories = useMemo(() => {
    if (!stories.length) return []
    if (progressCount <= 0) {
      return isRefreshing ? [] : stories
    }
    return stories.slice(0, Math.min(progressCount, stories.length))
  }, [stories, progressCount, isRefreshing])

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle>AI Research Highlights</CardTitle>
          <CardDescription>
            Combines Alpha Vantage fundamentals, recent news, and an OpenAI summary. Refresh pulls new market data and
            regenerates the narrative.
          </CardDescription>
        </div>
        <div className="flex items-center gap-3">
          {generatedAt && (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Updated {formatDistanceToNow(generatedAt, { addSuffix: true })}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadResearch({ force: true })}
            disabled={isRefreshing || isLoading}
          >
            {isRefreshing ? (
              <>
                <Spinner className="mr-2 h-4 w-4" /> Refreshing…
              </>
            ) : (
              <>
                <RefreshCcw className="mr-2 h-4 w-4" /> Refresh
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
            <div className="font-medium">Unable to load research</div>
            <p className="mt-1">{error}</p>
          </div>
        )}

        {!error && warningText && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
            <div className="font-medium">Latest notice</div>
            <p className="mt-1">{warningText}</p>
          </div>
        )}

        {isLoading && !data && !error && (
          <div className="flex items-center justify-center py-16 text-slate-500 dark:text-slate-400">
            <Spinner className="mr-3 text-blue-600" />
            Fetching cached research…
          </div>
        )}

        {!isLoading && !error && resultText.trim().length === 0 && (
          <div className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">
            No AI research is available yet for this portfolio.
          </div>
        )}

        {(isRefreshing || progressTotal > 0) && (
          <div className="space-y-2 rounded-xl border border-slate-200/70 bg-slate-50/60 p-4 dark:border-slate-800/60 dark:bg-slate-900/40">
            <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
              <span>Research progress</span>
              {progressTotal > 0 ? (
                <span>
                  {Math.min(progressCount, progressTotal)} / {progressTotal} tickers
                </span>
              ) : (
                <span>Waiting for tickers…</span>
              )}
            </div>
            <Progress value={progressTotal ? (Math.min(progressCount, progressTotal) / progressTotal) * 100 : 0} />
          </div>
        )}

        {visibleStories.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
              {modelName && <span>Model: {modelName}</span>}
              {typeof lookbackDays === "number" && <span>Lookback: {lookbackDays}d</span>}
              <span>Tickers analysed: {data?.meta?.tickerCount ?? tickers.length}</span>
              {generatedAt && <span>Generated {formatDistanceToNow(generatedAt, { addSuffix: true })}</span>}
            </div>
            <div className="grid gap-4">
              {visibleStories.map((story) => (
                <ResearchTickerCard
                  key={story.ticker}
                  story={story}
                  insight={insightsByTicker.get(story.ticker)}
                />
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

export default PortfolioResearch

type TickerStoryCardProps = {
  story: { ticker: string; summary: string }
  insight?: InsightEntry
}

function ResearchTickerCard({ story, insight }: TickerStoryCardProps) {
  const sector = insight?.overview?.Sector ?? insight?.overview?.Industry ?? "—"
  const marketCap = formatMarketCap(insight?.overview?.MarketCapitalization)
  const peRatio = insight?.overview?.PERatio ? Number(insight.overview.PERatio).toFixed(1) : "—"
  const dividend =
    insight?.overview?.DividendYield && Number(insight.overview.DividendYield) > 0
      ? `${(Number(insight.overview.DividendYield) * 100).toFixed(2)}%`
      : "—"
  const change1d =
    typeof insight?.price?.changePercent1d === "number" ? `${insight.price.changePercent1d.toFixed(2)}%` : "—"
  const news = Array.isArray(insight?.news) ? insight?.news?.slice(0, 2) : []
  const insiders = Array.isArray(insight?.insiders) ? insight.insiders.slice(0, 2) : []

  return (
    <Card className="border-slate-200/80 shadow-sm dark:border-slate-800">
      <CardHeader className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="text-base font-semibold uppercase tracking-wide">
            {story.ticker}
          </Badge>
          <span className="text-sm text-slate-500 dark:text-slate-400">{sector}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span>1D: {change1d}</span>
          <span>PE: {peRatio}</span>
          <span>Dividend: {dividend}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-200">{story.summary}</p>
        {(news.length > 0 || insiders.length > 0 || marketCap) && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Headlines
              </h4>
              {news.length === 0 && <p className="text-xs text-slate-500 dark:text-slate-400">No recent articles.</p>}
              {news.map((article, idx) => (
                <a
                  key={`${story.ticker}-news-${idx}`}
                  href={article.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-md border border-slate-200/60 p-2 text-xs hover:border-blue-400 dark:border-slate-800/60 dark:hover:border-blue-400"
                >
                  <div className="font-medium text-slate-800 dark:text-slate-200">{article.title}</div>
                  {article.summary && (
                    <p className="mt-1 line-clamp-2 text-slate-600 dark:text-slate-400">{article.summary}</p>
                  )}
                  <div className="mt-2 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-500">
                    {article.source ?? "Unknown source"}
                  </div>
                </a>
              ))}
            </div>
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Insider & Fundamentals
              </h4>
              <div className="rounded-lg border border-slate-200/60 p-3 text-xs dark:border-slate-800/60">
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Market Cap</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{marketCap ?? "—"}</span>
                </div>
                <div className="mt-1 flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Latest EPS</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {insight?.earnings?.reportedEPS ?? "—"}
                  </span>
                </div>
              </div>
              {insiders.length > 0 ? (
                <div className="space-y-2 rounded-lg border border-slate-200/60 p-3 text-xs dark:border-slate-800/60">
                  {insiders.map((tx, idx) => (
                    <div key={`${story.ticker}-insider-${idx}`} className="flex justify-between">
                      <span className="text-slate-600 dark:text-slate-300">
                        {tx.name ?? tx.transactionType ?? "Insider"}
                      </span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {tx.transactionType ?? ""} {tx.share ? `(${tx.share} shares)` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400">No insider filings this period.</p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function formatMarketCap(value: unknown) {
  const num = typeof value === "string" ? Number(value) : typeof value === "number" ? value : null
  if (!num || !Number.isFinite(num)) return "—"
  if (num >= 1e12) return `${(num / 1e12).toFixed(2)}T`
  if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`
  if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`
  return num.toLocaleString()
}
