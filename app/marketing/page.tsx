"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { motion, AnimatePresence } from "framer-motion"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  ArrowRight,
  ShieldCheck,
  BarChart3,
  FileText,
  Newspaper,
  PieChart as PieIcon,
  Sparkles,
  Download,
  Mail,
  TrendingUp,
  Layers3,
  Gauge,
  Activity,
} from "lucide-react"
import {
  AreaChart,
  Area,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts"
import { ExternalLink, AlertTriangle, Info } from "lucide-react"

// ------------------------------------------------------------
// One‑pager marketing/showcase for your app.
// Drop under app/(marketing)/features/page.tsx
// ------------------------------------------------------------

const perfData = Array.from({ length: 12 }).map((_, i) => ({
  month: new Date(2024, i, 1).toLocaleString("en", { month: "short" }),
  portfolio: 100 + i * 2 + (i % 3 === 0 ? 4 : 0),
  benchmark: 100 + i * 1.3,
}))

// Demo current portfolio sector allocation (sums to ~100)
const allocationData = [
  { name: "Technology", value: 32 },
  { name: "Healthcare", value: 18 },
  { name: "Financials", value: 14 },
  { name: "Industrials", value: 12 },
  { name: "Consumer", value: 9 },
  { name: "Energy", value: 8 },
  { name: "Other", value: 7 },
]

// --- Research demo types (mirrors analysis UI shape) ---
type Sentiment = "positive" | "negative" | "neutral"
type Impact = "high" | "medium" | "low"
const REPORT_URL = "/portfolioSummary.pdf";

interface DemoNewsArticle {
  title: string
  source: string
  date: string   // display-only
  url: string
  sentiment: Sentiment
  impact: Impact
  summary: string
}

interface DemoResearchInsight {
  type: "opportunity" | "risk" | "rebalance"
  title: string
  description: string
  confidence: number   // 0..1
  recommendation: string
  sources: string[]
  priority: "high" | "medium" | "low"
  rationale?: string
  whyItMatters?: string
  consequences?: string
  evidence?: string[]
  sourceLinks?: Array<{ title: string; url: string }>
}

// --- Factual, evergreen recommendations (no market-timing claims) ---
const DEMO_RECOMMENDATIONS: DemoResearchInsight[] = [
  {
    type: "rebalance",
    title: "Trim overweight Technology to ~30%",
    description:
      "Portfolio shows a technology allocation materially above broad benchmarks.",
    confidence: 0.9,
    recommendation:
      "Reduce Technology weight toward ~30% to lower concentration risk while preserving growth exposure.",
    sources: ["Diversification best practices", "Benchmark sector weights"],
    priority: "high",
    rationale:
      "Concentration in a single sector increases idiosyncratic risk; aligning closer to benchmark reduces volatility spikes.",
    whyItMatters:
      "Improves risk-adjusted profile without relying on short-term market timing.",
    consequences:
      "Slightly lower upside if Tech outperforms; improved drawdown characteristics if it underperforms.",
    evidence: [
      "Benchmarks (e.g., S&P 500 / MSCI World) typically keep single-sector weights below ~35%.",
      "Academic literature: diversification reduces unsystematic risk."
    ],
    sourceLinks: [
      { title: "What Is Diversification? (Investopedia)", url: "https://www.investopedia.com/terms/d/diversification.asp" },
      { title: "Sector Weighting Basics (Investopedia)", url: "https://www.investopedia.com/terms/s/sector.asp" }
    ]
  },
  {
    type: "opportunity",
    title: "Increase Healthcare tilt to 18–20%",
    description:
      "Healthcare historically exhibits defensive characteristics with consistent cash flows.",
    confidence: 0.85,
    recommendation:
      "Increase Healthcare to ~18–20% using diversified ETFs or large-cap incumbents.",
    sources: ["Sector defensiveness literature"],
    priority: "medium",
    rationale:
      "Defensive sectors can stabilize returns across cycles and complement growth-heavy exposures.",
    whyItMatters:
      "Balances cyclicality; reduces sensitivity to broad market drawdowns.",
    sourceLinks: [
      { title: "Defensive Sectors Overview (Investopedia)", url: "https://www.investopedia.com/terms/d/defensivestock.asp" }
    ]
  },
  {
    type: "rebalance",
    title: "Add 10% Developed ex-US exposure",
    description:
      "Home-country bias can reduce diversification benefits across currencies and economic regimes.",
    confidence: 0.8,
    recommendation:
      "Allocate ~10% to developed ex-US (e.g., a broad ETF) to improve geographic diversification.",
    sources: ["Global market composition"],
    priority: "medium",
    rationale:
      "International exposure spreads macro and policy risks and may improve long-run risk-adjusted returns.",
    sourceLinks: [
      { title: "Home Bias in Portfolios (Investopedia)", url: "https://www.investopedia.com/terms/h/homebias.asp" }
    ]
  }
]

// --- Evergreen, factual news/education cards (no time-sensitive claims) ---
const DEMO_NEWS: DemoNewsArticle[] = [
  {
    title: "How diversification reduces unsystematic risk",
    source: "Investopedia",
    date: "Reference",
    url: "https://www.investopedia.com/terms/d/diversification.asp",
    sentiment: "neutral",
    impact: "medium",
    summary:
      "A primer on diversification, portfolio construction, and why spreading exposures reduces single-name and sector risk."
  },
  {
    title: "Understanding sector rotation and cyclicality",
    source: "Investopedia",
    date: "Reference",
    url: "https://www.investopedia.com/terms/s/sectorrotation.asp",
    sentiment: "neutral",
    impact: "medium",
    summary:
      "Explains how leadership changes across sectors through the business cycle and what that implies for portfolio tilts."
  },
  {
    title: "What portfolio beta says about market risk",
    source: "Investopedia",
    date: "Reference",
    url: "https://www.investopedia.com/terms/b/beta.asp",
    sentiment: "neutral",
    impact: "low",
    summary:
      "Defines beta, how it’s calculated versus a benchmark like the S&P 500, and how it affects volatility expectations."
  }
]


// Demo benchmark sector weights to mirror the analysis page logic (target weights)
// NOTE: Numbers are illustrative; the UI computes tilts exactly like the analysis page
const BENCHMARK_WEIGHTS: Record<string, Record<string, number>> = {
  "^GSPC": {
    Technology: 29,
    Healthcare: 13,
    Financials: 12,
    Industrials: 9,
    Consumer: 15,
    Energy: 4,
    Other: 18,
  },
  "^NDX": {
    Technology: 58,
    Healthcare: 7,
    Financials: 1,
    Industrials: 3,
    Consumer: 24,
    Energy: 0.5,
    Other: 6.5,
  },
  URTH: {
    Technology: 25,
    Healthcare: 12,
    Financials: 15,
    Industrials: 11,
    Consumer: 13,
    Energy: 5,
    Other: 19,
  },
  VT: {
    Technology: 23,
    Healthcare: 11,
    Financials: 16,
    Industrials: 12,
    Consumer: 13,
    Energy: 5,
    Other: 20,
  },
  VEA: {
    Technology: 12,
    Healthcare: 12,
    Financials: 18,
    Industrials: 17,
    Consumer: 14,
    Energy: 5,
    Other: 22,
  },
  EEM: {
    Technology: 21,
    Healthcare: 4,
    Financials: 22,
    Industrials: 8,
    Consumer: 13,
    Energy: 7,
    Other: 25,
  },
}

const COLORS = ["#2563eb", "#0ea5e9", "#22c55e", "#a78bfa", "#f59e0b", "#ef4444", "#14b8a6"]

export default function FeaturesPage() {
  const [benchmark, setBenchmark] = useState("^GSPC")
  const [isLoading, setIsLoading] = useState(false)
  const [activeCard, setActiveCard] = useState<string | null>(null)


  function downloadUrl(url: string, filename?: string) {
  const link = document.createElement("a");
  link.href = url;
  if (filename) link.download = filename; // Hint download; browsers may still open inline
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function handleExportPdf() {
  // show your nice loader first
  setIsLoading(true);

  // optional: ensure file exists before “completing”
  // fetch(REPORT_URL, { method: "HEAD" }).catch(() => {}).finally(() => { ... })

  setTimeout(() => {
    downloadUrl(REPORT_URL, "Portfolio_Summary_Report.pdf");
    setIsLoading(false);
  }, 1200); // feels like “generation”
}

function handleEmailPdf() {
  setIsLoading(true);
  setTimeout(() => {
    // Compose a new email with the link to the static PDF
    const subject = "Your Portfolio Summary Report";
    const body = `Hi,%0D%0A%0D%0AHere's the report:%0D%0A${window.location.origin}${REPORT_URL}%0D%0A%0D%0A– Sent from the demo`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${body}`;
    setIsLoading(false);
  }, 1000);
}

  function sentimentBadge(sentiment: Sentiment) {
  if (sentiment === "positive") return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Positive</Badge>
  if (sentiment === "negative") return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">Negative</Badge>
  return <Badge variant="secondary">Neutral</Badge>
}

function insightTint(type: DemoResearchInsight["type"]) {
  if (type === "opportunity") return "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20"
  if (type === "risk") return "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20"
  return "border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20"
}

function insightIcon(type: DemoResearchInsight["type"]) {
  if (type === "opportunity") return <TrendingUp className="w-5 h-5 text-green-600" />
  if (type === "risk") return <AlertTriangle className="w-5 h-5 text-red-600" />
  return <Info className="w-5 h-5 text-blue-600" />
}

  // playful loading to showcase skeleton/animation
  useEffect(() => {
    const t = setTimeout(() => setActiveCard("analysis"), 450)
    return () => clearTimeout(t)
  }, [])

  const diff = useMemo(() => {
    const last = perfData[perfData.length - 1]
    return ((last.portfolio - last.benchmark) / last.benchmark) * 100
  }, [])

  // --- Active tilts logic mirroring analysis page (sector-level) ---
  const sectorsAll = useMemo(() => {
    const target = BENCHMARK_WEIGHTS[benchmark] ?? BENCHMARK_WEIGHTS["^GSPC"]
    return allocationData.map((s) => ({
      sector: s.name,
      allocation: Number(s.value),
      target: Number(target[s.name] ?? 0),
    }))
  }, [benchmark])

  const diffs = useMemo(
    () => sectorsAll.map((s) => ({ ...s, diff: Number((s.allocation - s.target).toFixed(1)) })),
    [sectorsAll],
  )

  const activeSharePct = useMemo(() => {
    const sumAbs = diffs.reduce((acc, s) => acc + Math.abs(s.diff), 0)
    return Number((0.5 * sumAbs).toFixed(1))
  }, [diffs])

  const matchScore = useMemo(() => {
    const dot = sectorsAll.reduce((acc, s) => acc + (s.allocation || 0) * (s.target || 0), 0)
    const normP = Math.sqrt(sectorsAll.reduce((acc, s) => acc + Math.pow(s.allocation || 0, 2), 0))
    const normB = Math.sqrt(sectorsAll.reduce((acc, s) => acc + Math.pow(s.target || 0, 2), 0))
    return normP && normB ? Math.round((dot / (normP * normB)) * 100) : null
  }, [sectorsAll])

  const topOver = useMemo(
    () => diffs.filter((d) => d.diff > 0.5).sort((a, b) => b.diff - a.diff).slice(0, 3),
    [diffs],
  )
  const topUnder = useMemo(
    () => diffs.filter((d) => d.diff < -0.5).sort((a, b) => a.diff - b.diff).slice(0, 3),
    [diffs],
  )

  const sectorsForChart = allocationData.filter((s) => (s.value ?? 0) > 0.5)

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* HERO */}
      <section className="relative overflow-hidden">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="container mx-auto px-4 pt-16 pb-8"
        >
          <div className="max-w-5xl mx-auto text-center">
            <Badge variant="outline" className="mb-3">New</Badge>
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50">
              All‑in‑one Portfolio Intelligence
            </h1>
            <p className="mt-4 text-slate-600 dark:text-slate-400 text-lg">
              Upload. Analyze. Research. Report. A modern toolkit to understand and improve your investments.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg">
                <Link href="/auth/signup">
                  Start free trial
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </Button>
              <Button variant="outline" size="lg" asChild>
                <Link href="#live-demo">See it in action</Link>
              </Button>
            </div>

            {/* Animated KPIs */}
            <div className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Benchmarks", value: "S&P, NDX, URTH, VT" },
                { label: "Risk Metrics", value: "Vol, Sharpe, Beta, MDD" },
                { label: "Reports", value: "1‑click PDF & Email" },
                { label: "Research", value: "News & recs" },
              ].map((k, i) => (
                <motion.div
                  key={k.label}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 + i * 0.1 }}
                  className="rounded-2xl border bg-white/60 dark:bg-slate-900/40 backdrop-blur p-4"
                >
                  <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">{k.label}</div>
                  <div className="text-slate-900 dark:text-slate-100 font-semibold">{k.value}</div>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* background glow */}
        <div className="pointer-events-none absolute inset-x-0 -top-40 h-80 blur-3xl [mask-image:radial-gradient(closest-side,black,transparent)]" aria-hidden>
          <div className="mx-auto h-full max-w-5xl bg-gradient-to-r from-blue-500/20 via-sky-400/10 to-emerald-400/20" />
        </div>
      </section>

      {/* LIVE DEMO TABS */}
      <section id="live-demo" className="container mx-auto px-4 py-12">
        <Tabs defaultValue="analysis" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="analysis" onClick={() => setActiveCard("analysis")}>Analysis</TabsTrigger>
            <TabsTrigger value="holdings" onClick={() => setActiveCard("holdings")}>Holdings</TabsTrigger>
            <TabsTrigger value="research" onClick={() => setActiveCard("research")}>Research</TabsTrigger>
            <TabsTrigger value="report" onClick={() => setActiveCard("report")}>Report</TabsTrigger>
          </TabsList>

          {/* ANALYSIS */}
          <TabsContent value="analysis" className="space-y-6">
            <Card className="overflow-hidden">
              <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2"><BarChart3 className="w-5 h-5"/>Performance vs Benchmark</CardTitle>
                  <CardDescription>12‑month demo chart; switch benchmarks to see animations.</CardDescription>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-sm text-slate-600 dark:text-slate-400">Benchmark</div>
                  <Select value={benchmark} onValueChange={(v) => setBenchmark(v)}>
                    <SelectTrigger className="w-48"><SelectValue placeholder="Select"/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="^GSPC">S&P 500 (^GSPC)</SelectItem>
                      <SelectItem value="^NDX">NASDAQ 100 (^NDX)</SelectItem>
                      <SelectItem value="URTH">MSCI World (URTH)</SelectItem>
                      <SelectItem value="VT">Global (VT)</SelectItem>
                      <SelectItem value="VEA">Developed ex‑US (VEA)</SelectItem>
                      <SelectItem value="EEM">Emerging (EEM)</SelectItem>
                    </SelectContent>
                  </Select>

                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={perfData} margin={{ left: 0, right: 10 }}>
                      <defs>
                        <linearGradient id="p1" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopOpacity={0.35} />
                          <stop offset="95%" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="p2" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopOpacity={0.25} />
                          <stop offset="95%" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                      <XAxis dataKey="month" tickLine={false} axisLine={false} />
                      <YAxis tickLine={false} axisLine={false} />
                      <Tooltip formatter={(v: number) => v.toFixed(1)} />
                      <Area type="monotone" dataKey="portfolio" strokeWidth={2} stroke="#2563eb" fillOpacity={1} fill="url(#p1)" animationBegin={activeCard==="analysis"? 0 : 200} />
                      <Area type="monotone" dataKey="benchmark" strokeWidth={2} stroke="#22c55e" fillOpacity={1} fill="url(#p2)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {/* KPI strip */}
                <div className="mt-6 grid md:grid-cols-4 gap-4">
                  <Stat label="Portfolio Return" value={`+${(perfData.at(-1)!.portfolio-100).toFixed(1)}%`} positive />
                  <Stat label="vs Benchmark" value={`${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%`} positive={diff>=0} />
                  <Stat label="Volatility" value="12.3%" />
                  <Stat label="Sharpe" value="1.38" />
                </div>
              </CardContent>
            </Card>

            <div className="grid md:grid-cols-2 gap-6 items-start">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><PieIcon className="w-5 h-5"/>Sector Allocation</CardTitle>
                  <CardDescription>Demo pie — hover to see details; animated on mount.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={sectorsForChart} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} paddingAngle={2}>
                          {sectorsForChart.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* UPDATED: Active Sector Tilts (mirrors analysis page) */}
              <Card className="flex flex-col">
                <CardHeader>
                  <CardTitle>Active Sector Tilts</CardTitle>
                  <CardDescription>How you differ from the selected benchmark</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm text-slate-600 dark:text-slate-400">Active Share</div>
                      <div className="text-2xl font-bold">{activeSharePct}%</div>
                    </div>
                    <div>
                      <div className="text-sm text-slate-600 dark:text-slate-400">Benchmark Match</div>
                      <div className="text-2xl font-bold">{matchScore !== null ? `${matchScore}%` : "—"}</div>
                    </div>
                  </div>

                  {topOver.length > 0 && (
                    <div>
                      <div className="text-sm font-medium mb-2">Top Overweights</div>
                      <ul className="space-y-2">
                        {topOver.map((s) => (
                          <li key={`over-${s.sector}`} className="flex items-center justify-between">
                            <span className="text-sm">{s.sector}</span>
                            <Badge className="bg-green-600 hover:bg-green-600 text-white">+{s.diff.toFixed(1)}%</Badge>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {topUnder.length > 0 && (
                    <div>
                      <div className="text-sm font-medium mb-2">Top Underweights</div>
                      <ul className="space-y-2">
                        {topUnder.map((s) => (
                          <li key={`under-${s.sector}`} className="flex items-center justify-between">
                            <span className="text-sm">{s.sector}</span>
                            <Badge variant="secondary" className="text-red-600 dark:text-red-400">{s.diff.toFixed(1)}%</Badge>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* HOLDINGS */}
          <TabsContent value="holdings" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Holdings Analysis</CardTitle>
                <CardDescription>Per‑holding returns, contribution, volatility & composite risk.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-slate-500">
                        <th className="py-2">Ticker</th>
                        <th className="py-2">Weight</th>
                        <th className="py-2">Return</th>
                        <th className="py-2">Contribution</th>
                        <th className="py-2">Volatility</th>
                        <th className="py-2">Beta</th>
                        <th className="py-2">Risk</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[{ ticker: "NVDA", contrib: 4.6, beta: 1.2 }, { ticker: "AAPL", contrib: 3.1, beta: 1.0 }, { ticker: "MSFT", contrib: 2.7, beta: 0.9 }, { ticker: "TSLA", contrib: -1.1, beta: 1.5 }, { ticker: "XOM", contrib: 0.9, beta: 1.1 }].map((row, i) => (
                        <tr key={row.ticker} className="border-t border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="py-3 font-mono">{row.ticker}</td>
                          <td className="py-3">{(12 - i * 1.8).toFixed(1)}%</td>
                          <td className="py-3">
                            <span className={`font-medium ${row.contrib >= 0 ? "text-green-600" : "text-red-600"}`}>
                              {row.contrib >= 0 ? "+" : ""}{(row.contrib * 3).toFixed(1)}%
                            </span>
                          </td>
                          <td className="py-3">{row.contrib > 0 ? "+" : ""}{row.contrib.toFixed(1)}pp</td>
                          <td className="py-3">{(10 + i * 2.1).toFixed(1)}%</td>
                          <td className="py-3">{row.beta.toFixed(2)}</td>
                          <td className="py-3">
                            <Badge variant="outline" className={row.beta > 1.2 ? "text-red-600" : row.beta > 1 ? "text-amber-600" : "text-green-600"}>
                              {row.beta > 1.2 ? "High" : row.beta > 1 ? "Medium" : "Low"}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* RESEARCH */}
          {/* RESEARCH */}
<TabsContent value="research" className="space-y-6">
  {/* AI-Powered Research Insights (hardcoded demo) */}
  <Card>
    <CardHeader>
      <div className="flex items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Newspaper className="w-5 h-5" />
            <span>AI-Powered Research Insights</span>
          </CardTitle>
          <CardDescription>
            Research-backed recommendations using diversification and sector-tilt principles
          </CardDescription>
        </div>
      </div>
    </CardHeader>
    <CardContent>
      <div className="space-y-4">
        {DEMO_RECOMMENDATIONS.map((rec, i) => (
          <div key={i} className={`p-4 rounded-lg border ${insightTint(rec.type)}`}>
            <div className="flex items-start gap-3">
              {insightIcon(rec.type)}
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-slate-900 dark:text-slate-100">{rec.title}</h4>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">{rec.priority} priority</Badge>
                    <Badge variant="outline" className="text-xs">Confidence: {Math.round(rec.confidence * 100)}%</Badge>
                  </div>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-400">{rec.description}</p>

                {rec.whyItMatters && (
                  <div className="bg-white dark:bg-slate-800 p-3 rounded border">
                    <p className="text-sm"><strong>Why it matters:</strong> {rec.whyItMatters}</p>
                  </div>
                )}

                {rec.consequences && (
                  <div className="bg-white dark:bg-slate-800 p-3 rounded border">
                    <p className="text-sm"><strong>Potential consequences:</strong> {rec.consequences}</p>
                  </div>
                )}

                <div className="bg-white dark:bg-slate-800 p-3 rounded border">
                  <p className="text-sm"><strong>Recommendation:</strong> {rec.recommendation || rec.rationale}</p>
                </div>

                {rec.evidence && rec.evidence.length > 0 && (
                  <div className="pt-2">
                    <p className="text-xs text-slate-500 mb-2"><strong>Evidence:</strong></p>
                    <ul className="list-disc pl-5 space-y-1 text-xs text-slate-600 dark:text-slate-400">
                      {rec.evidence.map((ev, idx) => <li key={idx}>{ev}</li>)}
                    </ul>
                  </div>
                )}

                {(rec.sourceLinks?.length || rec.sources.length) ? (
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                    <p className="text-xs text-slate-500 mb-2"><strong>Sources:</strong></p>
                    <div className="flex flex-wrap gap-2">
                      {(rec.sourceLinks?.length ? rec.sourceLinks : rec.sources.map(s => ({ title: s, url: "#" }))).map((s, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs">
                          <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </CardContent>
  </Card>

  {/* Market News with Sources (hardcoded demo) */}
  <Card>
    <CardHeader>
      <CardTitle>Relevant Market News & Education</CardTitle>
      <CardDescription>Evergreen resources explaining concepts referenced in the insights</CardDescription>
    </CardHeader>
    <CardContent>
      <div className="space-y-4">
        {DEMO_NEWS.map((n, i) => (
          <div key={i} className="border rounded-lg p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                {sentimentBadge(n.sentiment)}
                <Badge variant="outline" className="text-xs">{n.impact} impact</Badge>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>{n.source}</span>
                <span>•</span>
                <span>{n.date}</span>
              </div>
            </div>

            <h4 className="font-semibold text-slate-900 dark:text-slate-100 mb-2 leading-tight">
              {n.title}
            </h4>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
              {n.summary}
            </p>

            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Educational reference</span>
              <Button variant="ghost" size="sm" asChild>
                <a href={n.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-4 h-4 mr-1" />
                  Read Article
                </a>
              </Button>
            </div>
          </div>
        ))}
      </div>

      {DEMO_NEWS.length === 0 && (
        <div className="text-center py-8 text-slate-500 dark:text-slate-400">
          <Info className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No items</p>
        </div>
      )}
    </CardContent>
  </Card>
</TabsContent>


          {/* REPORT */}
          <TabsContent value="report" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5"/>Summary Report</CardTitle>
                <CardDescription>Client‑ready PDF exports styled like a bank research report.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-4 gap-4">
                  <Metric label="Overall Score" value="86/100" />
                  <Metric label="Total Return" value="+24.3%" positive />
                  <Metric label="Holdings" value="18" />
                  <Metric label="Sharpe" value="1.42" />
                </div>

                <div className="mt-6 flex flex-wrap gap-3">
  <Button onClick={handleExportPdf} disabled={isLoading}>
    {isLoading ? <Activity className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
    Export Professional PDF
  </Button>

</div>


                {/* animated checklist */}
                
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </section>

      {/* FEATURE GRID */}
      <section className="container mx-auto px-4 pb-16">
        <div className="grid md:grid-cols-3 gap-6">
          <Feature icon={<ShieldCheck className="w-5 h-5"/>} title="Secure auth & multi‑portfolio" desc="Supabase auth, your data only. Create, upload and manage multiple portfolios with ease."/>
          <Feature icon={<TrendingUp className="w-5 h-5"/>} title="Performance vs benchmark" desc="Compare against S&P 500, NDX, URTH, VT and more, including excess returns."/>
          <Feature icon={<PieIcon className="w-5 h-5"/>} title="Allocation & tilts" desc="See sector weights vs targets, active share, and top over/under weights."/>
          <Feature icon={<Gauge className="w-5 h-5"/>} title="Risk engine" desc="Volatility, Sharpe, beta vs SPX, drawdowns, and a composite per‑holding risk score."/>
          <Feature icon={<Layers3 className="w-5 h-5"/>} title="Holdings analysis" desc="Contribution since purchase, weighted betas, volatility and drill‑downs."/>
          <Feature icon={<Newspaper className="w-5 h-5"/>} title="Research & news" desc="Auto‑curated insights with sources and one‑click actions."/>
          <Feature icon={<FileText className="w-5 h-5"/>} title="Bank‑grade PDF reports" desc="One‑click professional exports and email sharing for clients."/>
          <Feature icon={<Sparkles className="w-5 h-5"/>} title="Delightful UX" desc="Snappy animations, responsive charts, dark mode, and keyboard‑friendly."/>
          <Feature icon={<Activity className="w-5 h-5"/>} title="Developer‑ready APIs" desc="REST endpoints back your UI for easy extensions and automation."/>
        </div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          className="mt-12 rounded-3xl border p-6 bg-white/60 dark:bg-slate-900/40 text-center"
        >
          <h3 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Ready to try it?</h3>
          <p className="text-slate-600 dark:text-slate-400 mt-1">Start a free trial or talk to us about team plans.</p>
          <div className="mt-4 flex items-center justify-center gap-3">
            <Button asChild><Link href="/auth/signup">Get started</Link></Button>
            <Button variant="outline" asChild><Link href="/pricing">View pricing</Link></Button>
          </div>
        </motion.div>
      </section>

      <AnimatedLoader open={isLoading} onClose={() => setIsLoading(false)} />
    </div>
  )
}

function Stat({ label, value, positive = false }: { label: string; value: string; positive?: boolean }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="rounded-xl border p-4">
      <div className="text-sm text-slate-600 dark:text-slate-400">{label}</div>
      <div className={`text-2xl font-bold ${positive ? "text-green-600 dark:text-green-400" : "text-slate-900 dark:text-slate-100"}`}>{value}</div>
    </motion.div>
  )
}

function Metric({ label, value, positive = false }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="text-center rounded-xl border p-4">
      <div className="text-sm text-slate-600 dark:text-slate-400">{label}</div>
      <div className={`text-2xl font-bold ${positive ? "text-green-600 dark:text-green-400" : "text-slate-900 dark:text-slate-100"}`}>{value}</div>
    </div>
  )
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.4 }}
      className="rounded-2xl border p-5 bg-white/60 dark:bg-slate-900/40"
    >
      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-sky-600 text-white flex items-center justify-center shadow mb-3">
        {icon}
      </div>
      <div className="font-semibold text-slate-900 dark:text-slate-100">{title}</div>
      <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">{desc}</div>
    </motion.div>
  )
}

function AnimatedLoader({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-900/30 backdrop-blur"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.98, opacity: 0 }}
            className="rounded-2xl border bg-white dark:bg-slate-900 p-6 w-[380px] shadow-2xl"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-600/10 grid place-items-center">
                <Activity className="w-5 h-5 animate-spin" />
              </div>
              <div>
                <div className="font-semibold">Generating…</div>
                <div className="text-sm text-slate-600 dark:text-slate-400">Creating a professional report preview</div>
              </div>
            </div>
            <div className="mt-4">
              <Progress value={75} className="h-2" />
              <div className="mt-2 text-xs text-slate-500">This is a demo animation. Click anywhere to close.</div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function fakeDelay(setter: (b: boolean) => void) {
  setter(true)
  setTimeout(() => setter(false), 1000)
}
