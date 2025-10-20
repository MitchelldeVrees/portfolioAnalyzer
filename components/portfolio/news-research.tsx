"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { formatDistanceToNow } from "date-fns"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { LoadingButton } from "@/components/ui/loading-button"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import { ExternalLink } from "lucide-react"

interface NewsItem {
  ticker: string
  headline: string
  sentiment: "positive" | "neutral" | "negative"
  impact?: "high" | "medium" | "low"
  summary: string
  themes?: string[]
  source?: string
  date?: string
  url?: string
}

interface RealTimeNewsSection {
  summary: string
  keyThemes: string[]
  sentimentScore: { positive: number; neutral: number; negative: number }
  items: NewsItem[]
}

interface Scenario {
  name: string
  description: string
  assumptions?: string[]
  expectedOutcome: string
  impactOnPortfolio?: { returnPct?: number; maxDrawdownPct?: number }
  suggestedActions?: string[]
}

interface RiskSection {
  overview: string
  methodology: string
  scenarios: Scenario[]
}

interface HoldingInsight {
  ticker: string
  narrative: string
  metrics: Array<{ label: string; value: string }>
  peerComparison?: string
  esgNote?: string | null
}

interface FundamentalsSection {
  overview: string
  holdings: HoldingInsight[]
  recommendations: string[]
}

interface ResearchReport {
  realTimeNews: RealTimeNewsSection | null
  riskAndScenarioModeling: RiskSection | null
  fundamentalComparative: FundamentalsSection | null
}

interface ResearchResponse {
  report: ResearchReport
  recommendations: string[]
  metadata?: {
    generatedAt?: string
    newsSources?: Array<{ ticker: string; source: string; url?: string; date?: string }>
    model?: string
    lookbackDays?: number
  }
  created_at?: string
}

interface NewsResearchProps {
  portfolioId: string
}

export function NewsResearch({ portfolioId }: NewsResearchProps) {
  const [report, setReport] = useState<ResearchReport | null>(null)
  const [recommendations, setRecommendations] = useState<string[]>([])
  const [metadata, setMetadata] = useState<ResearchResponse["metadata"]>({})
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadReport = useCallback(
    async (opts?: { forceRefresh?: boolean }) => {
      try {
        if (opts?.forceRefresh) {
          setIsRefreshing(true)
        } else {
          setIsLoading(true)
        }
        setError(null)
        const res = await fetch(`/api/portfolio/${portfolioId}/research`, {
          method: opts?.forceRefresh ? "POST" : "GET",
          headers: opts?.forceRefresh ? { "Content-Type": "application/json" } : undefined,
          body: opts?.forceRefresh ? JSON.stringify({}) : undefined,
        })
        if (!res.ok) {
          throw new Error(`Request failed (${res.status})`)
        }
        const data = (await res.json()) as ResearchResponse
        setReport(data.report ?? null)
        setRecommendations(Array.isArray(data.recommendations) ? data.recommendations : [])
        setMetadata(data.metadata ?? {})
        const generatedAt = data.metadata?.generatedAt || data.created_at
        setLastUpdated(generatedAt ? new Date(generatedAt) : new Date())
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load research")
      } finally {
        setIsLoading(false)
        setIsRefreshing(false)
      }
    },
    [portfolioId],
  )

  useEffect(() => {
    loadReport()
  }, [loadReport])

  const sentimentPercentages = useMemo(() => {
    if (!report?.realTimeNews?.sentimentScore) return null
    const { positive = 0, neutral = 0, negative = 0 } = report.realTimeNews.sentimentScore
    const total = positive + neutral + negative
    if (total <= 0) return null
    return {
      positive: Math.round((positive / total) * 100),
      neutral: Math.round((neutral / total) * 100),
      negative: Math.max(0, 100 - Math.round((positive / total) * 100) - Math.round((neutral / total) * 100)),
    }
  }, [report?.realTimeNews?.sentimentScore])

  if (isLoading) {
    return <ResearchSkeleton />
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-3">
          <div className="text-lg font-semibold text-red-600 dark:text-red-400">{error}</div>
          <div className="text-sm text-slate-500 dark:text-slate-400">
            Something went wrong while generating the AI research pack. Please try again.
          </div>
          <LoadingButton onClick={() => loadReport({ forceRefresh: true })} loading={isRefreshing} spinnerPlacement="start">
            Retry
          </LoadingButton>
        </CardContent>
      </Card>
    )
  }

  if (!report) {
    return null
  }

  const newsSection = report.realTimeNews
  const riskSection = report.riskAndScenarioModeling
  const fundamentalsSection = report.fundamentalComparative

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <CardTitle className="text-2xl">AI Research Briefing</CardTitle>
            <CardDescription>
              {metadata?.lookbackDays
                ? `News & analysis over the past ${metadata.lookbackDays} days`
                : "Live sentiment, scenario planning, and fundamentals"}
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Updated {lastUpdated ? formatDistanceToNow(lastUpdated, { addSuffix: true }) : "just now"}
            </span>
            <LoadingButton
              variant="outline"
              size="sm"
              onClick={() => loadReport({ forceRefresh: true })}
              loading={isRefreshing}
              loadingText="Refreshing..."
              spinnerPlacement="start"
            >
              Refresh
            </LoadingButton>
          </div>
        </CardHeader>
      </Card>

      {newsSection && (
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle>Real-Time News & Sentiment</CardTitle>
            <CardDescription>{newsSection.summary}</CardDescription>
            {newsSection.keyThemes?.length ? (
              <div className="flex flex-wrap gap-2 pt-2">
                {newsSection.keyThemes.map((theme) => (
                  <Badge key={theme} variant="secondary" className="text-xs">
                    {theme}
                  </Badge>
                ))}
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-6">
            {sentimentPercentages && (
              <div className="grid gap-3 md:grid-cols-3">
                <SentimentMeter label="Positive" value={sentimentPercentages.positive} intent="positive" />
                <SentimentMeter label="Neutral" value={sentimentPercentages.neutral} intent="neutral" />
                <SentimentMeter label="Negative" value={sentimentPercentages.negative} intent="negative" />
              </div>
            )}

            <div className="space-y-4">
              {newsSection.items?.map((item, idx) => (
                <div key={`${item.ticker}-${idx}`} className="border rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="font-mono">
                        {item.ticker}
                      </Badge>
                      <SentimentBadge sentiment={item.sentiment} />
                      {item.impact ? (
                        <Badge variant="secondary" className="uppercase text-[10px] tracking-wide">
                          {item.impact} impact
                        </Badge>
                      ) : null}
                    </div>
                    {item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Read
                      </a>
                    ) : null}
                  </div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">{item.headline}</div>
                  <p className="text-sm text-slate-600 dark:text-slate-400">{item.summary}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    {item.source ? <span>{item.source}</span> : null}
                    {item.date ? <span>{new Date(item.date).toLocaleDateString()}</span> : null}
                    {Array.isArray(item.themes) && item.themes.length ? (
                      <div className="flex flex-wrap gap-1">
                        {item.themes.map((theme) => (
                          <Badge key={theme} variant="outline" className="text-[10px]">
                            {theme}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {riskSection && (
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle>Advanced Risk & Scenario Modeling</CardTitle>
            <CardDescription>{riskSection.overview}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              {riskSection.scenarios?.map((scenario, idx) => (
                <div key={idx} className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">{scenario.name}</div>
                    {scenario.impactOnPortfolio && (
                      <div className="text-right text-xs text-slate-500 dark:text-slate-400">
                        {typeof scenario.impactOnPortfolio.returnPct === "number" ? (
                          <div>
                            Return impact: {scenario.impactOnPortfolio.returnPct > 0 ? "+" : ""}
                            {scenario.impactOnPortfolio.returnPct.toFixed(1)}%
                          </div>
                        ) : null}
                        {typeof scenario.impactOnPortfolio.maxDrawdownPct === "number" ? (
                          <div>Peak drawdown: {scenario.impactOnPortfolio.maxDrawdownPct.toFixed(1)}%</div>
                        ) : null}
                      </div>
                    )}
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400">{scenario.description}</p>
                  {Array.isArray(scenario.assumptions) && scenario.assumptions.length ? (
                    <div className="space-y-1">
                      <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 font-medium">
                        Key drivers
                      </div>
                      <ul className="list-disc list-inside text-sm text-slate-600 dark:text-slate-400 space-y-1">
                        {scenario.assumptions.map((assumption, assumptionIdx) => (
                          <li key={assumptionIdx}>{assumption}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <div className="text-sm text-slate-600 dark:text-slate-400">
                    <span className="font-medium text-slate-900 dark:text-slate-100">Expected outcome:</span>{" "}
                    {scenario.expectedOutcome}
                  </div>
                  {Array.isArray(scenario.suggestedActions) && scenario.suggestedActions.length ? (
                    <div className="space-y-1">
                      <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 font-medium">
                        Suggested actions
                      </div>
                      <ul className="list-disc list-inside text-sm text-slate-600 dark:text-slate-400 space-y-1">
                        {scenario.suggestedActions.map((action, actionIdx) => (
                          <li key={actionIdx}>{action}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/40 border p-4 text-xs text-slate-500 dark:text-slate-400">
              {riskSection.methodology}
            </div>
          </CardContent>
        </Card>
      )}

      {fundamentalsSection && (
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle>Fundamental & Comparative Analysis</CardTitle>
            <CardDescription>{fundamentalsSection.overview}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              {fundamentalsSection.holdings?.map((holding) => (
                <div key={holding.ticker} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono text-sm">
                        {holding.ticker}
                      </Badge>
                    </div>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400">{holding.narrative}</p>
                  {Array.isArray(holding.metrics) && holding.metrics.length ? (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {holding.metrics.map((metric, metricIdx) => (
                        <div key={metricIdx} className="rounded-md bg-slate-50 dark:bg-slate-900/40 p-3">
                          <div className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                            {metric.label}
                          </div>
                          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {metric.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {holding.peerComparison ? (
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {holding.peerComparison}
                    </div>
                  ) : null}
                  {holding.esgNote ? (
                    <div className="text-xs text-emerald-600 dark:text-emerald-400">{holding.esgNote}</div>
                  ) : null}
                </div>
              ))}
            </div>
            {Array.isArray(fundamentalsSection.recommendations) && fundamentalsSection.recommendations.length ? (
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 font-medium mb-2">
                  Portfolio Actions Suggested by AI
                </div>
                <ul className="list-disc list-inside space-y-1 text-sm text-slate-600 dark:text-slate-400">
                  {fundamentalsSection.recommendations.map((rec, index) => (
                    <li key={index}>{rec}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      {recommendations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Top-Level Recommendations</CardTitle>
            <CardDescription>Highlights distilled from the AI modules</CardDescription>
          </CardHeader>
          <CardContent>
            <ul>
  {recommendations.map((rec, idx) => (
    <li key={idx}>
      {typeof rec === "string"
        ? rec
        : rec.title ?? rec.description ?? JSON.stringify(rec)}
    </li>
  ))}
</ul>

          </CardContent>
        </Card>
      )}

      {metadata?.newsSources && metadata.newsSources.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Sources</CardTitle>
            <CardDescription>
              AI summaries are grounded in the latest articles and fundamentals pulled from trusted feeds
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {metadata.newsSources.slice(0, 8).map((source, idx) => (
              <div key={idx} className="text-xs text-slate-500 dark:text-slate-400">
                <span className="font-medium text-slate-700 dark:text-slate-300 mr-2">{source.ticker}</span>
                {source.source}
                {source.date ? ` Ã¯Â¿Â½ ${new Date(source.date).toLocaleDateString()}` : ""}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function SentimentMeter({
  label,
  value,
  intent,
}: {
  label: string
  value: number
  intent: "positive" | "neutral" | "negative"
}) {
  const color =
    intent === "positive" ? "bg-emerald-500" : intent === "negative" ? "bg-rose-500" : "bg-slate-400"

  return (
    <div className="rounded-lg border p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className="flex items-center gap-2 mt-2">
        <div className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{value}%</div>
      </div>
      <div className="mt-3 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <div className={cn("h-2 rounded-full", color)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
    </div>
  )
}

function SentimentBadge({ sentiment }: { sentiment: "positive" | "neutral" | "negative" }) {
  if (sentiment === "positive") {
    return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">Positive</Badge>
  }
  if (sentiment === "negative") {
    return <Badge className="bg-rose-500/10 text-rose-600 border-rose-500/30">Negative</Badge>
  }
  return <Badge variant="outline">Neutral</Badge>
}

function ResearchSkeleton() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-9 w-24" />
        </CardHeader>
      </Card>

      {[1, 2, 3].map((section) => (
        <Card key={section}>
          <CardHeader>
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-72 mt-2" />
          </CardHeader>
          <CardContent className="space-y-4">
            {[0, 1].map((row) => (
              <div key={row} className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export default NewsResearch
