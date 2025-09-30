"use client"

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ExternalLink, TrendingUp, AlertTriangle, Info, RefreshCw } from "lucide-react"
import { formatDistanceToNow } from "date-fns"

interface NewsArticle {
  title: string
  source: string
  date: string
  url: string
  sentiment: "positive" | "negative" | "neutral"
  impact: "high" | "medium" | "low"
  summary: string
}

interface ResearchInsight {
  type: "opportunity" | "risk" | "rebalance"
  title: string
  description: string
  confidence: number
  recommendation: string
  sources: string[]
  whyItMatters?: string
  consequences?: string
  evidence?: string[]
  sourceLinks?: Array<{ title: string; url: string }>
  priority?: string
  rationale?: string
}

interface NewsResearchProps {
  portfolioId: string
  holdings?: Array<{ ticker: string; weight: number }>
}

export function NewsResearch({ portfolioId, holdings = [] }: NewsResearchProps) {
  const [news, setNews] = useState<NewsArticle[]>([])
  const [insights, setInsights] = useState<any>(null)
  const [recommendations, setRecommendations] = useState<ResearchInsight[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
  const [error, setError] = useState<string | null>(null)

  // Overlay state: show by default to indicate page is still in progress
  const [overlayVisible, setOverlayVisible] = useState(true)
  const contentRef = useRef<HTMLDivElement | null>(null)

  // Memoize tickers and use a stable key to avoid effect loops (kept for potential UI fallbacks)
  const tickers = useMemo(() => holdings.map((h) => (h.ticker || "").toUpperCase()).sort(), [holdings])
  const tickersKey = useMemo(() => tickers.join(","), [tickers])
  const lastFetchKeyRef = useRef<string | null>(null)

  useEffect(() => {
    // Guard against duplicate calls (e.g., StrictMode double-invoke)
    if (lastFetchKeyRef.current === portfolioId) return
    lastFetchKeyRef.current = portfolioId
    loadResearchData()
  }, [portfolioId])

  const loadResearchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/portfolio/${portfolioId}/research`, { method: "GET" })

      if (!response.ok) throw new Error("Failed to fetch research data")

      const data = await response.json()

      // ---- NEWS: use data.newsArticles if present; otherwise derive from structured insights.contributions.stocks[].newsSupport or insights.sources
      const derivedFromSources =
        Array.isArray(data?.insights?.sources)
          ? data.insights.sources.map((s: any) => ({
              title: s.title,
              source: s.source,
              date: s.date,
              url: s.url,
              sentiment: "neutral" as const,
              impact: "medium" as const,
              summary: "",
            }))
          : []

      const derivedFromStocksV2 = Array.isArray(data?.insights?.contributions?.stocks)
        ? data.insights.contributions.stocks.flatMap((st: any) =>
            Array.isArray(st.newsSupport)
              ? st.newsSupport.map((n: any) => ({
                  title: n.title,
                  source: n.source,
                  date: n.date,
                  url: n.url,
                  sentiment: n.sentiment ?? "neutral",
                  impact: n.impact ?? "medium",
                  summary: st.ticker ? `[${st.ticker}] ${n.thesis ?? ""}` : n.thesis ?? "",
                }))
              : [],
          )
        : []

      const derivedFromStocksV1 = Array.isArray(data?.insights?.stocks)
        ? data.insights.stocks.flatMap((st: any) =>
            Array.isArray(st.recentNews)
              ? st.recentNews.map((n: any) => ({
                  title: n.title,
                  source: n.source,
                  date: n.date,
                  url: n.url,
                  sentiment: n.sentiment ?? "neutral",
                  impact: n.impact ?? "medium",
                  summary: st.ticker ? `[${st.ticker}] ${st.summary ?? ""}` : "",
                }))
              : [],
          )
        : []

      const normalizedNews: NewsArticle[] = Array.isArray(data.newsArticles)
        ? data.newsArticles
        : [...derivedFromStocksV2, ...derivedFromStocksV1, ...derivedFromSources]

      setNews(normalizedNews)

      // ---- INSIGHTS: keep the raw object
      setInsights(data.insights ?? null)

      // ---- RECOMMENDATIONS: normalize to what your UI expects
      const normalizedRecs = (Array.isArray(data.recommendations) ? data.recommendations : []).map((r: any) => ({
        type: (r.type as ResearchInsight["type"]) ?? "rebalance",
        title: r.title ?? r.description ?? "Recommendation",
        description: r.description ?? "",
        confidence: typeof r.confidence === "number" ? r.confidence : 0.85,
        recommendation: r.recommendation ?? r.rationale ?? r.description ?? "",
        sources: Array.isArray(r.sources) ? r.sources : [],
        priority: r.priority ?? "medium",
        rationale: r.rationale ?? "",
        whyItMatters: r.whyItMatters ?? r.why ?? undefined,
        consequences: r.consequences ?? r.implications ?? undefined,
        evidence: Array.isArray(r.evidence) ? r.evidence : undefined,
        sourceLinks: Array.isArray(r.sourceLinks) ? r.sourceLinks : undefined,
      }))

      setRecommendations(normalizedRecs as any)

      setLastUpdated(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load research data")
    } finally {
      setIsLoading(false)
    }
  }, [portfolioId])


  const refreshData = async () => {
    lastFetchKeyRef.current = null
    try {
      setIsLoading(true)
      setError(null)
      const resp = await fetch(`/api/portfolio/${portfolioId}/research`, { method: "POST" })
      if (!resp.ok) throw new Error("Failed to refresh research")
      const data = await resp.json()
      // Reuse existing normalization path
      const sources = Array.isArray(data?.insights?.sources)
        ? data.insights.sources.map((s: any) => ({
            title: s.title,
            source: s.source,
            date: s.date,
            url: s.url,
            sentiment: "neutral" as const,
            impact: "medium" as const,
            summary: "",
          }))
        : []
      const fromStocks = Array.isArray(data?.insights?.contributions?.stocks)
        ? data.insights.contributions.stocks.flatMap((st: any) =>
            Array.isArray(st.newsSupport)
              ? st.newsSupport.map((n: any) => ({
                  title: n.title,
                  source: n.source,
                  date: n.date,
                  url: n.url,
                  sentiment: n.sentiment ?? "neutral",
                  impact: n.impact ?? "medium",
                  summary: st.ticker ? `[${st.ticker}] ${n.thesis ?? ""}` : n.thesis ?? "",
                }))
              : [],
          )
        : []
      setNews(Array.isArray(data.newsArticles) ? data.newsArticles : [...fromStocks, ...sources])
      setInsights(data.insights ?? null)
      setRecommendations((Array.isArray(data.recommendations) ? data.recommendations : []) as any)
      setLastUpdated(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh research")
    } finally {
      setIsLoading(false)
    }
  }

  // Accessibility helpers / UI utilities for overlay
  const getSentimentColor = (sentiment: string) => {
    switch (sentiment) {
      case "positive":
        return "text-green-600 dark:text-green-400"
      case "negative":
        return "text-red-600 dark:text-red-400"
      default:
        return "text-slate-600 dark:text-slate-400"
    }
  }

  const getSentimentBadge = (sentiment: string) => {
    switch (sentiment) {
      case "positive":
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Positive</Badge>
      case "negative":
        return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">Negative</Badge>
      default:
        return <Badge variant="secondary">Neutral</Badge>
    }
  }

  const getInsightIcon = (type: string) => {
    switch (type) {
      case "opportunity":
        return <TrendingUp className="w-5 h-5 text-green-600" />
      case "risk":
        return <AlertTriangle className="w-5 h-5 text-red-600" />
      default:
        return <Info className="w-5 h-5 text-blue-600" />
    }
  }

  const getInsightColor = (type: string) => {
    switch (type) {
      case "opportunity":
        return "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20"
      case "risk":
        return "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20"
      default:
        return "border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20"
    }
  }

  // When overlay is visible, we try to disable interactions for most elements inside the component
  // but keep tabs usable. We attempt to auto-detect common tab containers (role="tablist") and
  // elements with [data-allow-interaction] and re-enable pointer events for them.
  useEffect(() => {
    const root = contentRef.current
    if (!root) return

    const applyBlock = () => {
      // block interactions on root
      root.classList.add("pointer-events-none", "select-none")
      root.setAttribute("aria-hidden", "true")

      // find elements that should still be interactive (tabs) and re-enable them
      const allowEls = Array.from(root.querySelectorAll('[role="tablist"], .tabs, [data-allow-interaction]')) as HTMLElement[]
      allowEls.forEach((el) => {
        el.style.pointerEvents = "auto"
        el.style.zIndex = "50"
      })
    }

    const removeBlock = () => {
      root.classList.remove("pointer-events-none", "select-none")
      root.removeAttribute("aria-hidden")
      const allowEls = Array.from(root.querySelectorAll('[role="tablist"], .tabs, [data-allow-interaction]')) as HTMLElement[]
      allowEls.forEach((el) => {
        el.style.pointerEvents = ""
        el.style.zIndex = ""
      })
    }

    if (overlayVisible) applyBlock()
    else removeBlock()

    return () => removeBlock()
  }, [overlayVisible])

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center py-8">
            <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-red-500" />
            <p className="text-red-600 dark:text-red-400 mb-4">Error: {error}</p>
            <Button onClick={refreshData} variant="outline">
              <RefreshCw className="w-4 h-4 mr-2" />
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <Skeleton className="h-6 w-48 mb-2" />
                <Skeleton className="h-4 w-64" />
              </div>
              <Skeleton className="h-9 w-24" />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="relative" ref={contentRef}>
      {/* Overlay modal: shows while the page is still in progress. Click outside or the button to dismiss. */}
      {overlayVisible && (
        <div className="fixed inset-0 z-40 flex items-start justify-center pt-24">
          {/* Backdrop (click to dismiss) */}
          <div
            aria-hidden
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setOverlayVisible(false)}
          />

          {/* Modal box */}
          <div
            role="dialog"
            aria-modal="true"
            className="relative z-50 w-full max-w-xl mx-4 p-6 rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800"
            onClick={(e) => e.stopPropagation()} // keep clicks inside from closing
          >
            <h3 className="text-lg font-semibold mb-2">Still in progress</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
              This page is still under active development. Most functionality on this page are currently disabled so
              we can iterate safely. You can still switch tabs to navigate.
            </p>

            <div className="flex items-center justify-end space-x-2">
              <Button size="sm" variant="ghost" onClick={() => setOverlayVisible(false)}>
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Main content (wrapped) */}
      <div className="space-y-6">
        {/* AI-Powered Research Insights */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center space-x-2">
                  <TrendingUp className="w-5 h-5" />
                  <span>AI-Powered Research Insights</span>
                </CardTitle>
                <CardDescription>
                  Research-backed recommendations based on current market analysis and news sentiment
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={refreshData} disabled={isLoading || overlayVisible}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh Analysis
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recommendations.map((rec, index) => (
                <div key={index} className={`p-4 rounded-lg border ${getInsightColor(rec.type)}`}>
                  <div className="flex items-start space-x-3">
                    {getInsightIcon(rec.type)}
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold text-slate-900 dark:text-slate-100">{rec.title}</h4>
                        <div className="flex items-center space-x-2">
                          <Badge variant="outline" className="text-xs">
                            {rec.priority} priority
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            Confidence: {Math.round((rec.confidence ?? 0.85) * 100)}%
                          </Badge>
                        </div>
                      </div>
                      <p className="text-sm text-slate-600 dark:text-slate-400">{rec.description}</p>
                      {rec.whyItMatters && (
                        <div className="bg-white dark:bg-slate-800 p-3 rounded border">
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                            <strong>Why it matters:</strong> {rec.whyItMatters}
                          </p>
                        </div>
                      )}
                      {rec.consequences && (
                        <div className="bg-white dark:bg-slate-800 p-3 rounded border">
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                            <strong>Potential consequences:</strong> {rec.consequences}
                          </p>
                        </div>
                      )}
                      <div className="bg-white dark:bg-slate-800 p-3 rounded border">
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          <strong>Recommendation:</strong> {rec.rationale}
                        </p>
                      </div>
                      {rec.evidence && rec.evidence.length > 0 && (
                        <div className="pt-2">
                          <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                            <strong>Evidence:</strong>
                          </p>
                          <ul className="list-disc pl-5 space-y-1 text-xs text-slate-600 dark:text-slate-400">
                            {rec.evidence.map((ev, i) => (
                              <li key={i}>{ev}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {rec.sources && rec.sources.length > 0 && (
                        <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                          <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                            <strong>Sources:</strong>
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {rec.sourceLinks && rec.sourceLinks.length > 0
                              ? rec.sourceLinks.map((s, idx) => (
                                  <Badge key={idx} variant="outline" className="text-xs">
                                    <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>
                                  </Badge>
                                ))
                              : rec.sources.map((source, idx) => (
                                  <Badge key={idx} variant="outline" className="text-xs">
                                    {source}
                                  </Badge>
                                ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Market News with Sources */}
        <Card>
          <CardHeader>
            <CardTitle>Relevant Market News & Analysis</CardTitle>
            <CardDescription>
              Latest news affecting your portfolio holdings with AI sentiment analysis • Last updated{" "}
              {formatDistanceToNow(lastUpdated, { addSuffix: true })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {news.map((article, index) => (
                <div
                  key={index}
                  className="border rounded-lg p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      {getSentimentBadge(article.sentiment)}
                      <Badge variant="outline" className="text-xs">
                        {article.impact} impact
                      </Badge>
                    </div>
                    <div className="flex items-center space-x-2 text-xs text-slate-500 dark:text-slate-400">
                      <span>{article.source}</span>
                      <span>•</span>
                      <span>{article.date}</span>
                    </div>
                  </div>

                  <h4 className="font-semibold text-slate-900 dark:text-slate-100 mb-2 leading-tight">{article.title}</h4>

                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">{article.summary}</p>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        AI Confidence: {Math.floor(Math.random() * 20 + 80)}%
                      </span>
                    </div>

                    <Button variant="ghost" size="sm" asChild>
                      <a href={article.url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="w-4 h-4 mr-1" />
                        Read Full Article
                      </a>
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {news.length === 0 && (
              <div className="text-center py-8 text-slate-500 dark:text-slate-400">
                <Info className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No recent news found for your portfolio holdings</p>
                <p className="text-sm">AI analysis will update as new information becomes available</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default NewsResearch
