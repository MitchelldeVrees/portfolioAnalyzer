"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { formatDistanceToNow } from "date-fns"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { RefreshCcw } from "lucide-react"

type ResearchResponse = {
  result: string
  tickers: string[]
  generatedAt?: string
  meta?: {
    workflowId?: string
    workflowVersion?: string
    runId?: string
    status?: string
  }
}

type PortfolioResearchProps = {
  portfolioId: string
}

export function PortfolioResearch({ portfolioId }: PortfolioResearchProps) {
  const [data, setData] = useState<ResearchResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadResearch = useCallback(
    async (opts?: { force?: boolean }) => {
      try {
        setError(null)
        if (opts?.force) {
          setIsRefreshing(true)
        } else {
          setIsLoading(true)
        }
        const res = await fetch(`/api/portfolio/${portfolioId}/research`, {
          method: opts?.force ? "POST" : "GET",
          headers: { "Content-Type": "application/json" },
        })
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
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load research"
        setError(message)
        setData(null)
      } finally {
        setIsLoading(false)
        setIsRefreshing(false)
      }
    },
    [portfolioId],
  )

  useEffect(() => {
    loadResearch().catch(() => {
      // handled in loadResearch
    })
  }, [loadResearch])

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
  const workflowVersion = data?.meta?.workflowVersion
  const workflowStatus = data?.meta?.status

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle>AI Research Highlights</CardTitle>
          <CardDescription>
            Generated via the OpenAI ChatKit workflow. Holdings are sent as tickers to your agent and the response is
            rendered below.
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

        {isLoading && !data && !error && (
          <div className="flex items-center justify-center py-16 text-slate-500 dark:text-slate-400">
            <Spinner className="mr-3 text-blue-600" />
            Fetching AI research…
          </div>
        )}

        {!isLoading && !error && resultText.trim().length === 0 && (
          <div className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">
            No AI research is available yet for this portfolio.
          </div>
        )}

        {resultText.trim().length > 0 && (
          <div className="space-y-5 rounded-xl border border-slate-200/70 bg-white p-5 shadow-sm dark:border-slate-800/60 dark:bg-slate-900/40">
            <div className="flex flex-wrap items-center gap-2">
              {tickers.map((ticker) => (
                <Badge key={ticker} variant="outline">
                  {ticker}
                </Badge>
              ))}
              {tickers.length === 0 && <span className="text-xs text-slate-500 dark:text-slate-400">No tickers detected.</span>}
            </div>
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-200">{resultText}</div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
              {workflowVersion && <span>Workflow version: {workflowVersion}</span>}
              {workflowStatus && <span>Status: {workflowStatus}</span>}
              {data?.meta?.runId && <span>Run ID: {data.meta.runId}</span>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default PortfolioResearch
