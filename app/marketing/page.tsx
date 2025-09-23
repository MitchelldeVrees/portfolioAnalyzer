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
import { ScrollArea } from "@/components/ui/scroll-area"
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
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  Legend,
} from "recharts"

// ------------------------------------------------------------
// This page is a one‑pager marketing/showcase for your app.
// It uses the same design system (shadcn/ui + Tailwind),
// animated with Framer Motion, with interactive fake data.
// Drop it under app/(marketing)/features/page.tsx
// ------------------------------------------------------------

const perfData = Array.from({ length: 12 }).map((_, i) => ({
  month: new Date(2024, i, 1).toLocaleString("en", { month: "short" }),
  portfolio: 100 + i * 2 + (i % 3 === 0 ? 4 : 0),
  benchmark: 100 + i * 1.3,
}))

const allocationData = [
  { name: "Technology", value: 32 },
  { name: "Healthcare", value: 18 },
  { name: "Financials", value: 14 },
  { name: "Industrials", value: 12 },
  { name: "Consumer", value: 9 },
  { name: "Energy", value: 8 },
  { name: "Other", value: 7 },
]

const barData = [
  { ticker: "NVDA", contrib: 4.6, beta: 1.2 },
  { ticker: "AAPL", contrib: 3.1, beta: 1.0 },
  { ticker: "MSFT", contrib: 2.7, beta: 0.9 },
  { ticker: "TSLA", contrib: -1.1, beta: 1.5 },
  { ticker: "XOM", contrib: 0.9, beta: 1.1 },
]

const COLORS = ["#2563eb", "#0ea5e9", "#22c55e", "#a78bfa", "#f59e0b", "#ef4444", "#14b8a6"]

export default function FeaturesPage() {
  const [benchmark, setBenchmark] = useState("^GSPC")
  const [isLoading, setIsLoading] = useState(false)
  const [activeCard, setActiveCard] = useState<string | null>(null)

  // playful loading to showcase skeleton/animation
  useEffect(() => {
    const t = setTimeout(() => setActiveCard("analysis"), 450)
    return () => clearTimeout(t)
  }, [])

  const diff = useMemo(() => {
    const last = perfData[perfData.length - 1]
    return ((last.portfolio - last.benchmark) / last.benchmark) * 100
  }, [])

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
                    <SelectTrigger className="w-44"><SelectValue placeholder="Select"/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="^GSPC">S&P 500 (^GSPC)</SelectItem>
                      <SelectItem value="^NDX">NASDAQ 100 (^NDX)</SelectItem>
                      <SelectItem value="URTH">MSCI World (URTH)</SelectItem>
                      <SelectItem value="VT">Global (VT)</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" onClick={() => {setIsLoading(true); setTimeout(()=>setIsLoading(false), 900)}}>
                    {isLoading ? <Activity className="w-4 h-4 mr-2 animate-spin"/> : <Sparkles className="w-4 h-4 mr-2"/>}
                    Re‑simulate
                  </Button>
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
                        <Pie data={allocationData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} paddingAngle={2}>
                          {allocationData.map((_, i) => (
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

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Gauge className="w-5 h-5"/>Active Tilts & Contributions</CardTitle>
                  <CardDescription>Demo bar — contribution vs beta.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={barData}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                        <XAxis dataKey="ticker" />
                        <YAxis yAxisId="left" />
                        <YAxis yAxisId="right" orientation="right" />
                        <Tooltip />
                        <Legend />
                        <Bar yAxisId="left" dataKey="contrib" name="Contribution (pp)" fill="#2563eb" radius={[6,6,0,0]} />
                        <Bar yAxisId="right" dataKey="beta" name="Beta" fill="#f59e0b" radius={[6,6,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
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
                      {barData.map((row, i) => (
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
          <TabsContent value="research" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Newspaper className="w-5 h-5"/>Research & News</CardTitle>
                <CardDescription>Pre‑generated insights, curated sources, and prioritized actions.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-3 gap-4">
                  {[
                    {
                      title: "Trim overweight tech",
                      body: "Reduce technology allocation from 35% → 30% to manage concentration risk.",
                      tag: "Allocation",
                    },
                    {
                      title: "Upgrade healthcare",
                      body: "Increase healthcare to 20% through diversified ETFs or established pharma.",
                      tag: "Sector",
                    },
                    {
                      title: "Add international",
                      body: "Add 10–15% developed ex‑US exposure to improve diversification.",
                      tag: "Geography",
                    },
                  ].map((r, i) => (
                    <motion.div
                      key={r.title}
                      initial={{ opacity: 0, y: 14, scale: 0.98 }}
                      whileInView={{ opacity: 1, y: 0, scale: 1 }}
                      viewport={{ once: true, amount: 0.3 }}
                      transition={{ duration: 0.4, delay: i * 0.05 }}
                      className="rounded-xl border p-4"
                    >
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold text-slate-900 dark:text-slate-100">{r.title}</h4>
                        <Badge>{r.tag}</Badge>
                      </div>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">{r.body}</p>
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" variant="outline">View sources</Button>
                        <Button size="sm">Apply suggestion</Button>
                      </div>
                    </motion.div>
                  ))}
                </div>
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

          v      <div className="mt-6 flex flex-wrap gap-3">
                  <Button onClick={() => fakeDelay(setIsLoading)} disabled={isLoading}>
                    {isLoading ? <Activity className="w-4 h-4 mr-2 animate-spin"/> : <Download className="w-4 h-4 mr-2"/>}
                    Export Professional PDF
                  </Button>
                  <Button variant="outline" onClick={() => fakeDelay(setIsLoading)} disabled={isLoading}>
                    {isLoading ? <Activity className="w-4 h-4 mr-2 animate-spin"/> : <Mail className="w-4 h-4 mr-2"/>}
                    Email Report
                  </Button>
                </div>

                {/* animated checklist */}
                <div className="mt-8 grid md:grid-cols-3 gap-4">
                  {[
                    { t: "Executive summary", s: 100 },
                    { t: "Performance vs benchmark", s: 100 },
                    { t: "Risk & drawdowns", s: 100 },
                    { t: "Sector allocation", s: 100 },
                    { t: "Holdings table", s: 100 },
                    { t: "Action items", s: 100 },
                  ].map((it, i) => (
                    <motion.div key={it.t} initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} transition={{ delay: i * 0.05 }} className="rounded-xl border p-4">
                      <div className="text-sm text-slate-600 mb-2">{it.t}</div>
                      <Progress value={it.s} className="h-2" />
                    </motion.div>
                  ))}
                </div>
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
