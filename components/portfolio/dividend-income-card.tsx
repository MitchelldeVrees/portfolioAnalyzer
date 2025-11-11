"use client"

import { useMemo, useState } from "react"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, LineChart, Line, Legend } from "recharts"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type DividendTimelinePoint = {
  key: string
  label: string
  amount: number
}

type DividendEvent = {
  ticker: string
  date: string
  amountPerShare: number
  shares: number
  cashAmount: number
  currency?: string | null
}

type DividendInsights = {
  year: number
  totalIncome: number
  monthlyTotals: DividendTimelinePoint[]
  quarterlyTotals: DividendTimelinePoint[]
  events: DividendEvent[]
}

interface DividendIncomeCardProps {
  dividends: DividendInsights
}

function formatCurrency(value: number, currency?: string | null) {
  const code = currency && typeof currency === "string" ? currency : "USD"
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${code} ${value.toFixed(2)}`
  }
}

function formatShares(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)
}

function formatDate(value: string) {
  const date = new Date(value)
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function DividendBarChart({ data }: { data: DividendTimelinePoint[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-800" />
          <XAxis dataKey="label" className="text-slate-600 dark:text-slate-400" />
          <YAxis
            className="text-slate-600 dark:text-slate-400"
            tickFormatter={(value) => `$${value}`}
            width={60}
          />
          <Tooltip
            formatter={(value: number) => [formatCurrency(value), "Cash"]}
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              color: "hsl(var(--card-foreground))",
            }}
          />
          <Bar dataKey="amount" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function DividendIncomeCard({ dividends }: DividendIncomeCardProps) {
  const hasEvents = (dividends?.events?.length ?? 0) > 0
  const [showFuture, setShowFuture] = useState(false)
  const [monthlyContribution, setMonthlyContribution] = useState(250)
  const futureProjection = useMemo(() => buildFutureProjection(dividends, monthlyContribution), [dividends, monthlyContribution])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dividend Income</CardTitle>
        <CardDescription>
          Cash payouts recorded for your holdings in {dividends.year}. Totals update whenever you refresh portfolio data.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!hasEvents ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            None of your positions have distributed cash dividends so far this year.
          </p>
        ) : (
          <Tabs defaultValue="monthly" className="w-full">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <TabsList>
                <TabsTrigger value="monthly">Monthly</TabsTrigger>
                <TabsTrigger value="quarterly">Quarterly</TabsTrigger>
              </TabsList>
              <div className="text-sm text-slate-600 dark:text-slate-400">
                Year-to-date income:{" "}
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {formatCurrency(dividends.totalIncome)}
                </span>
              </div>
            </div>
            <TabsContent value="monthly" className="mt-4">
              <DividendBarChart data={dividends.monthlyTotals} />
            </TabsContent>
            <TabsContent value="quarterly" className="mt-4">
              <DividendBarChart data={dividends.quarterlyTotals} />
            </TabsContent>
          </Tabs>
        )}

        {hasEvents && (
          <>
            <div className="flex flex-col gap-3 rounded-xl border border-slate-200/70 bg-slate-50/60 p-4 dark:border-slate-800/60 dark:bg-slate-900/40 md:flex-row md:items-center md:justify-between">
              <div>
                <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100">Future insights</h4>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Compare passive dividend withdrawals versus reinvesting payouts with an optional monthly contribution.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div>
                  <Label htmlFor="monthly-contribution" className="text-xs uppercase tracking-wide text-slate-500">
                    Monthly contribution
                  </Label>
                  <Input
                    id="monthly-contribution"
                    type="number"
                    min={0}
                    step={50}
                    value={monthlyContribution}
                    onChange={(event) => setMonthlyContribution(Math.max(0, Number(event.target.value) || 0))}
                    className="mt-1 w-40"
                  />
                </div>
                <Button variant={showFuture ? "secondary" : "outline"} onClick={() => setShowFuture((prev) => !prev)}>
                  {showFuture ? "Hide Future Insights" : "Show Future Insights"}
                </Button>
              </div>
            </div>
            {showFuture && (
              <div className="space-y-4 rounded-xl border border-slate-200/80 bg-white/60 p-5 dark:border-slate-800/80 dark:bg-slate-900/40">
                <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600 dark:text-slate-400">
                  <span>
                    Monthly reinvest income:&nbsp;
                    <strong className="text-slate-900 dark:text-slate-100">
                      {formatCurrency(futureProjection.lastMonth.reinvested)}
                    </strong>
                  </span>
                  <span>
                    Monthly cash income:&nbsp;
                    <strong className="text-slate-900 dark:text-slate-100">
                      {formatCurrency(futureProjection.lastMonth.distributed)}
                    </strong>
                  </span>
                  <span className="text-xs uppercase tracking-wide text-slate-500">
                    Horizon: {futureProjection.months} months
                  </span>
                </div>
                <FutureProjectionChart data={futureProjection.data} />
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Reinvesting dividends with an extra{" "}
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {formatCurrency(monthlyContribution)}
                  </span>{" "}
                  per month could lift monthly income by{" "}
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {formatCurrency(futureProjection.lastMonth.reinvested - futureProjection.lastMonth.distributed)}
                  </span>{" "}
                  after {futureProjection.months} months.
                </p>
              </div>
            )}
          </>
        )}

        {hasEvents && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100">Payout schedule</h4>
              <span className="text-sm text-slate-600 dark:text-slate-400">
                Dates reflect ex-dividend announcements this calendar year.
              </span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticker</TableHead>
                  <TableHead>Ex-Date</TableHead>
                  <TableHead>Per Share</TableHead>
                  <TableHead>Shares</TableHead>
                  <TableHead>Cash Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dividends.events.map((event) => (
                  <TableRow key={`${event.ticker}-${event.date}`}>
                    <TableCell className="font-medium">{event.ticker}</TableCell>
                    <TableCell>{formatDate(event.date)}</TableCell>
                    <TableCell>{formatCurrency(event.amountPerShare, event.currency)}</TableCell>
                    <TableCell>{formatShares(event.shares)}</TableCell>
                    <TableCell className="font-semibold">
                      {formatCurrency(event.cashAmount, event.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

type ProjectionPoint = {
  label: string
  reinvested: number
  distributed: number
}

type ProjectionResult = {
  data: ProjectionPoint[]
  totals: {
    reinvested: number
    distributed: number
  }
  lastMonth: {
    reinvested: number
    distributed: number
  }
  months: number
}

function buildFutureProjection(dividends: DividendInsights, monthlyContribution: number, months = 36): ProjectionResult {
  const monthlySeries = Array.isArray(dividends.monthlyTotals) ? dividends.monthlyTotals : []
  const validMonths = monthlySeries.filter((m) => m.amount > 0)
  const baseMonthlyIncome =
    (validMonths.reduce((sum, entry) => sum + entry.amount, 0) / (validMonths.length || 1)) ||
    dividends.totalIncome / 12 ||
    25

  const distributedGrowth = 0.01 / 12
  const reinvestGrowth = 0.04 / 12
  const contributionYield = 0.03 / 12

  let distributedMonthly = baseMonthlyIncome
  let reinvestMonthly = baseMonthlyIncome
  let distributedCumulative = 0
  let reinvestCumulative = 0
  let lastDistributed = distributedMonthly
  let lastReinvested = reinvestMonthly

  const data: ProjectionPoint[] = []

  for (let i = 1; i <= months; i++) {
    distributedMonthly *= 1 + distributedGrowth
    distributedCumulative += distributedMonthly

    reinvestMonthly = reinvestMonthly * (1 + reinvestGrowth) + monthlyContribution * contributionYield
    reinvestCumulative += reinvestMonthly

    lastDistributed = distributedMonthly
    lastReinvested = reinvestMonthly

    data.push({
      label: `M${i}`,
      distributed: Number(distributedMonthly.toFixed(2)),
      reinvested: Number(reinvestMonthly.toFixed(2)),
    })
  }

  return {
    data,
    months,
    totals: {
      distributed: Number(distributedCumulative.toFixed(2)),
      reinvested: Number(reinvestCumulative.toFixed(2)),
    },
    lastMonth: {
      distributed: Number(lastDistributed.toFixed(2)),
      reinvested: Number(lastReinvested.toFixed(2)),
    },
  }
}

function FutureProjectionChart({ data }: { data: ProjectionPoint[] }) {
  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-800" />
          <XAxis dataKey="label" className="text-slate-600 dark:text-slate-400" />
          <YAxis
            className="text-slate-600 dark:text-slate-400"
            tickFormatter={(value) => `$${value}`}
            width={70}
          />
          <Tooltip
            formatter={(value: number, name: string) => [formatCurrency(value), name]}
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              color: "hsl(var(--card-foreground))",
            }}
          />
          <Legend />
          <Line type="monotone" dataKey="reinvested" stroke="#10b981" strokeWidth={3} name="Reinvest dividends" dot={false} />
          <Line type="monotone" dataKey="distributed" stroke="#3b82f6" strokeWidth={3} name="Take dividends as cash" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
