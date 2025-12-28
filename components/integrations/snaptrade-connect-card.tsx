"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { withCsrfHeaders } from "@/lib/security/csrf-client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LoadingButton } from "@/components/ui/loading-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type SnaptradeBrokerage = {
  id: string
  slug: string
  name: string
  description?: string | null
  logo?: string | null
  maintenanceMode?: boolean
  enabled?: boolean
}

type SnaptradePosition = {
  units?: number | null
  fractional_units?: number | null
  price?: number | null
  average_purchase_price?: number | null
  currency?: { code?: string | null } | string | null
  price_currency?: string | null
  fx_to_base?: number | null
  price_base?: number | null
  value_base?: number | null
  symbol?: {
    symbol?: {
      symbol?: string
      raw_symbol?: string
      description?: string | null
      currency?: { code?: string | null } | null
    }
  }
}

type SnaptradeAccountHolding = {
  account?: {
    id?: string
    account_id?: string
    accountId?: string
    name?: string | null
    number?: string | null
    type?: string | null
    balance?: {
      total?: {
        amount?: number | null
        currency?: string | null
      }
    }
  }
  total_value?: {
    value?: number | null
    currency?: string | null
  }
  total_value_base?: {
    value?: number | null
    currency?: string | null
  }
  cash_base?: {
    value?: number | null
    currency?: string | null
  }
  base_currency?: string | null
  positions?: SnaptradePosition[] | null
}

type SnaptradeConnection = {
  id: string
  type: string
  createdAt: string | null
  disabled: boolean
  brokerage: {
    slug: string
    name: string
    logo: string | null
  } | null
}

export function SnaptradeConnectCard() {
  const router = useRouter()
  const [brokerages, setBrokerages] = useState<SnaptradeBrokerage[]>([])
  const [loadingBrokers, setLoadingBrokers] = useState(false)
  const [connectingSlug, setConnectingSlug] = useState<string | null>(null)
  const [connections, setConnections] = useState<SnaptradeConnection[]>([])
  const [loadingConnections, setLoadingConnections] = useState(false)
  const [holdings, setHoldings] = useState<SnaptradeAccountHolding[]>([])
  const [loadingHoldings, setLoadingHoldings] = useState(false)
  const [creatingPortfolio, setCreatingPortfolio] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const [pendingBroker, setPendingBroker] = useState<string | null>(null)
  const [pendingMessage, setPendingMessage] = useState<string | null>(null)
  const [snaptradeSummary, setSnaptradeSummary] = useState<{ total: number; currency?: string | null } | null>(null)
  const [snaptradeBaseSummary, setSnaptradeBaseSummary] = useState<{ total: number; currency?: string | null } | null>(
    null,
  )
  const [snaptradeBaseCurrency, setSnaptradeBaseCurrency] = useState("USD")
  const [autoSyncTriggered, setAutoSyncTriggered] = useState(false)
  const [portfolioNames, setPortfolioNames] = useState<Record<string, string>>({})
  const [portfolioBaseCurrencies, setPortfolioBaseCurrencies] = useState<Record<string, string>>({})
  const [expandedAccounts, setExpandedAccounts] = useState<Record<string, boolean>>({})
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [importAccountId, setImportAccountId] = useState<string | null>(null)
  const [importAccountLabel, setImportAccountLabel] = useState<string>("")
  const [importPortfolioName, setImportPortfolioName] = useState("")
  const [importPortfolioDescription, setImportPortfolioDescription] = useState("")
  const [importBaseCurrency, setImportBaseCurrency] = useState("USD")
  const [importError, setImportError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const pageSize = 9

  const BASE_CURRENCY_OPTIONS = ["USD", "EUR", "GBP", "CAD", "CHF", "SEK", "NOK", "JPY"]

  const normalizeCurrencyCode = (value?: { code?: string | null } | string | null) => {
    if (!value) return null
    if (typeof value === "string") return value.trim().toUpperCase() || null
    const code = value.code ?? null
    return code ? code.trim().toUpperCase() : null
  }

  const detectAccountCurrency = (account: SnaptradeAccountHolding) => {
    const positions = account.positions ?? []
    for (const position of positions ?? []) {
      const candidate =
        normalizeCurrencyCode(position.currency ?? null) ||
        normalizeCurrencyCode(position.symbol?.symbol?.currency ?? null)
      if (candidate) return candidate
    }
    return null
  }

  useEffect(() => {
    loadBrokerages()
    fetchConnections()
  }, [])

  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm])

  const loadBrokerages = async () => {
    setLoadingBrokers(true)
    try {
      const response = await fetch("/api/integrations/snaptrade/brokerages")
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to load broker list")
      }
      setBrokerages(Array.isArray(payload?.brokerages) ? payload.brokerages : [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load broker list")
    } finally {
      setLoadingBrokers(false)
    }
  }

  const fetchConnections = async () => {
    setLoadingConnections(true)
    try {
      const response = await fetch("/api/integrations/snaptrade/connections")
      const payload = await response.json()
      if (response.status === 503) {
        setError("Broker flow is not configured on this environment.")
        setConnections([])
        return
      }
      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to load connections")
      }
      setConnections(Array.isArray(payload?.connections) ? payload.connections : [])
      setPendingBroker(payload?.pendingBroker ?? null)
      setPendingMessage(payload?.pendingMessage ?? null)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load connections")
    } finally {
      setLoadingConnections(false)
    }
  }

  const fetchHoldings = async ({ logUserId = false } = {}) => {
    setLoadingHoldings(true)
    try {
      const response = await fetch("/api/integrations/snaptrade/holdings")
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to load holdings")
      }
      console.info("[snaptrade] holdings response:", payload)
      const baseCurrency = (payload?.baseCurrency ?? "USD").toUpperCase()
      setSnaptradeBaseCurrency(baseCurrency)
      if (payload?.fxRates && typeof payload.fxRates === "object") {
        console.info("[snaptrade] fx rates:", payload.fxRates)
      }
      if (logUserId) {
        const snaptradeUserId = payload?.snaptradeUserId ?? null
        console.info("[snaptrade] holdings user id:", snaptradeUserId)
      }
      const data = payload?.holdings
      const summary = payload?.summary
      const summaryBase = payload?.summaryBase
      if (summary && typeof summary.total === "number") {
        setSnaptradeSummary({
          total: summary.total,
          currency: summary.currency ?? undefined,
        })
      } else {
        setSnaptradeSummary(null)
      }
      if (summaryBase && typeof summaryBase.total === "number") {
        setSnaptradeBaseSummary({
          total: summaryBase.total,
          currency: summaryBase.currency ?? baseCurrency,
        })
      } else {
        setSnaptradeBaseSummary(null)
      }
      if (Array.isArray(data)) {
        setHoldings(data)
      } else if (data && Array.isArray(data.accounts)) {
        setHoldings(data.accounts)
      } else {
        setHoldings([])
      }
      setStatusMessage("Holdings snapshot updated.")
      setError(null)
      setLastSyncedAt(new Date())
    } catch (err) {
      setHoldings([])
      setLastSyncedAt(null)
      setError(err instanceof Error ? err.message : "Failed to load holdings")
      setSnaptradeSummary(null)
      setSnaptradeBaseSummary(null)
    } finally {
      setLoadingHoldings(false)
    }
  }

  useEffect(() => {
    if (connections.length === 0) {
      setAutoSyncTriggered(false)
      return
    }
    if (!autoSyncTriggered && connections.length > 0 && holdings.length === 0 && !loadingHoldings) {
      setAutoSyncTriggered(true)
      void fetchHoldings()
    }
  }, [connections.length, holdings.length, loadingHoldings, autoSyncTriggered])

  const openConnectionPortal = async (broker?: string | null) => {
    if (connections.length > 0) {
      setError("You already have an active broker connection. Remove it before linking another.")
      return
    }
    try {
      setConnectingSlug(broker ?? "__any__")
      const response = await fetch(
        "/api/integrations/snaptrade/link",
        withCsrfHeaders({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ broker }),
        }),
      )
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to start connection")
      }

      const url = payload?.redirectURI?.toString()
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer")
      }
      setStatusMessage("SnapTrade portal opened in a new tab.")
      setError(null)
      await fetchConnections()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open SnapTrade portal")
    } finally {
      setConnectingSlug(null)
    }
  }

  const createPortfolio = async (accountId: string, fallbackName?: string | null, fallbackCurrency?: string | null) => {
    setCreatingPortfolio(accountId)
    setStatusMessage(null)
    const portfolioName = getPortfolioName(accountId, fallbackName)
    const baseCurrency = getPortfolioBaseCurrency(accountId, fallbackCurrency)
    try {
      const response = await fetch(
        "/api/integrations/snaptrade/portfolio",
        withCsrfHeaders({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId, portfolioName, baseCurrency }),
        }),
      )
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to create portfolio")
      }
      setStatusMessage(
        payload?.portfolios?.length
          ? `Created portfolio${payload.portfolios.length > 1 ? "s" : ""}: ${payload.portfolios
              .map((p: any) => p.name)
              .join(", ")}`
          : "Portfolio created."
      )
      await fetchHoldings()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create portfolio")
    } finally {
      setCreatingPortfolio(null)
    }
  }

  const filteredBrokerages = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    const usable = brokerages.filter((broker) => broker.enabled !== false && !broker.maintenanceMode)
    if (!term) return usable
    return usable.filter((broker) => {
      const target = `${broker.name ?? ""} ${broker.slug ?? ""}`.toLowerCase()
      return target.includes(term)
    })
  }, [brokerages, searchTerm])

  const formattedSnaptradeBalance = useMemo(() => {
    const summary = snaptradeBaseSummary ?? snaptradeSummary
    if (!summary || typeof summary.total !== "number") return null
    const currency = snaptradeBaseCurrency || summary.currency || "USD"
    try {
      return new Intl.NumberFormat(navigator.language, { style: "currency", currency }).format(summary.total)
    } catch {
      return `${summary.total.toFixed(2)}${currency ? ` ${currency}` : ""}`
    }
  }, [snaptradeBaseCurrency, snaptradeBaseSummary, snaptradeSummary])

  const totalPages = Math.max(1, Math.ceil(filteredBrokerages.length / pageSize))
  const pagedBrokerages = filteredBrokerages.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages))
  }, [totalPages])

  function resolveAccountId(account: SnaptradeAccountHolding["account"]) {
    if (!account) return null
    return account.id ?? account.account_id ?? account.accountId ?? account.number ?? null
  }

  useEffect(() => {
    setPortfolioNames((prev) => {
      const next: Record<string, string> = {}
      for (const account of holdings) {
        const accountId = resolveAccountId(account.account)
        if (!accountId) continue
        const fallbackName =
          account.account?.name || account.account?.number || `SnapTrade account ${accountId.slice(-4)}`
        next[accountId] = prev[accountId] ?? fallbackName
      }
      const changed =
        Object.keys(next).length !== Object.keys(prev).length ||
        Object.keys(next).some((key) => next[key] !== prev[key])
      return changed ? next : prev
    })

    setPortfolioBaseCurrencies((prev) => {
      const next: Record<string, string> = {}
      for (const account of holdings) {
        const accountId = resolveAccountId(account.account)
        if (!accountId) continue
        const fallbackCurrency = detectAccountCurrency(account) ?? "USD"
        next[accountId] = prev[accountId] ?? fallbackCurrency
      }
      const changed =
        Object.keys(next).length !== Object.keys(prev).length ||
        Object.keys(next).some((key) => next[key] !== prev[key])
      return changed ? next : prev
    })
  }, [holdings])

  function getPortfolioName(accountId: string | null, fallback?: string | null) {
    if (!accountId) return fallback ?? "SnapTrade portfolio"
    return portfolioNames[accountId] ?? fallback ?? "SnapTrade portfolio"
  }

  const handlePortfolioNameChange = (accountId: string, value: string) => {
    setPortfolioNames((prev) => ({
      ...prev,
      [accountId]: value,
    }))
  }

  function getPortfolioBaseCurrency(accountId: string | null, fallback?: string | null) {
    if (!accountId) return snaptradeBaseCurrency || fallback || "USD"
    return portfolioBaseCurrencies[accountId] ?? snaptradeBaseCurrency ?? fallback ?? "USD"
  }

  const handleBaseCurrencyChange = (accountId: string, value: string) => {
    setPortfolioBaseCurrencies((prev) => ({
      ...prev,
      [accountId]: value.toUpperCase(),
    }))
  }

  const openImportModal = (accountId: string | null, label: string) => {
    setImportAccountId(accountId)
    setImportAccountLabel(label)
    setImportPortfolioName(label || "New portfolio")
    setImportPortfolioDescription("")
    setImportBaseCurrency(snaptradeBaseCurrency || "USD")
    setImportError(null)
    setImportDialogOpen(true)
  }

  const handleImportSubmit = async () => {
    if (!importPortfolioName.trim()) {
      setImportError("Portfolio name is required.")
      return
    }
    setImportError(null)
    setImporting(true)
    try {
      const response = await fetch(
        "/api/integrations/snaptrade/import",
        withCsrfHeaders({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId: importAccountId,
            portfolioName: importPortfolioName.trim(),
            description: importPortfolioDescription.trim() || undefined,
            baseCurrency: importBaseCurrency,
          }),
        }),
      )
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to import holdings")
      }
      setStatusMessage("Portfolio created from broker holdings.")
      setImportDialogOpen(false)
      const portfolioId = payload?.portfolio?.id ?? null
      if (portfolioId) {
        router.push(`/dashboard/portfolio/${portfolioId}`)
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to import holdings")
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="flex flex-col gap-2">
          <CardTitle>Connect your broker</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {statusMessage && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {statusMessage}
          </div>
        )}

        {connections.length > 0 && (
          <section className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/70 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-700">Linked brokers</h3>
                <p className="text-xs text-slate-500">
                  {connections.length === 1
                    ? "One connection is active according to our system."
                    : `${connections.length} connections are active according to our system.`}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={fetchConnections} disabled={loadingConnections}>
                  {loadingConnections ? "Refreshing…" : "Refresh status"}
                </Button>
                <LoadingButton
                  variant="secondary"
                  size="sm"
                  loading={loadingHoldings}
                  onClick={() => fetchHoldings({ logUserId: true })}
                >
                  {loadingHoldings ? "Fetching holdings…" : "Fetch holdings"}
                </LoadingButton>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {connections.map((connection) => (
                <div key={connection.id} className="rounded-md border border-white bg-white px-4 py-3 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-900">
                        {connection.brokerage?.name ?? connection.brokerage?.slug ?? "Broker"}
                      </p>
                      <p className="text-xs uppercase tracking-wide text-slate-500">
                        {connection.type === "trade" ? "Trading access" : "Read-only"}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-1 text-xs ${
                        connection.disabled ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      {connection.disabled ? "Pending" : "Active"}
                    </span>
                  </div>
                  {connection.disabled && (
                    <p className="mt-2 text-xs text-amber-800">
                      Awaiting brokerage confirmation. Fetch holdings again once approved.
                    </p>
                  )}
                </div>
              ))}
            </div>
            {lastSyncedAt && (
              <p className="text-xs text-slate-500">Last holdings sync: {lastSyncedAt.toLocaleString()}</p>
            )}
          </section>
        )}

        <section className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="w-full sm:max-w-xs">
              <Input
                placeholder="Search by broker name"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>
            
          </div>

          {connections.length === 0 && (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Connect a brokerage to import holdings automatically. Only one broker can be active per account.
            </p>
          )}
          {pendingBroker && pendingMessage && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">Waiting on {pendingBroker}</p>
              <p>{pendingMessage}</p>
            </div>
          )}

          {loadingBrokers && <p className="text-sm text-slate-500">Loading brokerages</p>}
          {!loadingBrokers && filteredBrokerages.length === 0 && (
            <p className="text-sm text-slate-500">No brokerages match your search.</p>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pagedBrokerages.map((broker) => (
              <div
                key={broker.slug}
                className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm flex flex-col gap-2"
              >
                <div className="flex items-center gap-3">
                  {broker.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={broker.logo} alt={broker.name} className="h-8 w-8 rounded-md object-contain" />
                  ) : (
                    <div className="h-8 w-8 rounded-md bg-slate-100 flex items-center justify-center text-xs font-semibold text-slate-600">
                      {broker.name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <p className="font-medium text-sm text-slate-900">{broker.name}</p>
                    {broker.description && <p className="text-xs text-slate-500">{broker.description}</p>}
                  </div>
                </div>
                {connections.length > 0 ? (
                  <Button variant="outline" className="mt-auto" disabled>
                    Broker linked
                  </Button>
                ) : (
                  <LoadingButton
                    variant="outline"
                    className="mt-auto"
                    loading={connectingSlug === broker.slug}
                    onClick={() => openConnectionPortal(broker.slug)}
                  >
                    Connect
                  </LoadingButton>
                )}
              </div>
            ))}
          </div>

          {filteredBrokerages.length > 0 && (
            <div className="flex flex-col gap-2 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
              <span>
                Page {currentPage} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={currentPage === 1}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </section>

        {holdings.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">Latest holdings snapshot</h3>
              {lastSyncedAt && (
                <span className="text-xs text-slate-500">Synced {lastSyncedAt.toLocaleString()}</span>
              )}
            </div>
            <p className="text-xs text-slate-500">
              All values shown in {snaptradeBaseCurrency} (base). Native amounts are shown when they differ.
            </p>
            {holdings.map((account, idx) => {
              const accountId = resolveAccountId(account.account)
              const accountKey = accountId ?? `account-${idx}`
              const name =
                account.account?.name || account.account?.number || `Linked account ${idx + 1}`
              const isExpanded = expandedAccounts[accountKey] ?? false
              const allPositions = Array.isArray(account.positions) ? account.positions : []
              const positions = isExpanded ? allPositions : allPositions.slice(0, 5)
              const cashAmount = account.account?.balance?.total?.amount ?? null
              const cashCurrency = normalizeCurrencyCode(account.account?.balance?.total?.currency ?? null)
              const cashBaseAmount =
                typeof account?.cash_base?.value === "number" ? (account.cash_base.value as number) : null
              const totalValueBase =
                typeof account?.total_value_base?.value === "number" ? (account.total_value_base.value as number) : null
              const totalValueNative = account.total_value?.value ?? null
              const totalCurrencyNative =
                normalizeCurrencyCode(account.total_value?.currency ?? null) ?? snaptradeSummary?.currency ?? null
              const baseCurrency = snaptradeBaseCurrency || account.base_currency || "USD"
              const formattedValue =
                typeof totalValueBase === "number"
                  ? new Intl.NumberFormat("en-US", { style: "currency", currency: baseCurrency }).format(
                      totalValueBase,
                    )
                  : null
              const formattedValueNative =
                totalCurrencyNative &&
                totalCurrencyNative !== baseCurrency &&
                typeof totalValueNative === "number" &&
                Number.isFinite(totalValueNative)
                  ? new Intl.NumberFormat("en-US", { style: "currency", currency: totalCurrencyNative }).format(
                      totalValueNative,
                    )
                  : null
              return (
                <div key={`${accountId ?? idx}`} className="rounded-lg border border-slate-200 p-4 space-y-3">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-slate-900">{name}</p>
                      {formattedValue && (
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {formattedValue}
                          {formattedValueNative && (
                            <span className="block text-xs font-normal text-slate-500">
                              Native: {formattedValueNative}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                    {account.account?.type && (
                      <p className="text-xs uppercase tracking-wide text-slate-500">{account.account.type}</p>
                    )}
                  </div>
                  {positions.length === 0 ? (
                    <p className="text-sm text-slate-500">No positions reported for this account yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      {allPositions.length > 5 && (
                        <div className="mb-2 flex items-center justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setExpandedAccounts((prev) => ({
                                ...prev,
                                [accountKey]: !isExpanded,
                              }))
                            }
                          >
                            {isExpanded ? "Show fewer" : `Show all (${allPositions.length})`}
                          </Button>
                        </div>
                      )}
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="text-left text-slate-500">
                            <th className="pb-1 pr-4">Symbol</th>
                            <th className="pb-1 pr-4">Units</th>
                            <th className="pb-1 pr-4">Value ({baseCurrency})</th>
                          </tr>
                        </thead>
                        <tbody>
                          {positions.map((position, positionIdx) => {
                            const ticker =
                              position.symbol?.symbol?.raw_symbol ??
                              ""
                            const description = position.symbol?.symbol?.description ?? ""
                            const priceCurrency =
                              normalizeCurrencyCode(position.currency) ??
                              normalizeCurrencyCode(position.symbol?.symbol?.currency ?? null) ??
                              baseCurrency ??
                              "USD"
                            const nativeUnits =
                              typeof position.units === "number"
                                ? position.units
                                : typeof position.fractional_units === "number"
                                  ? position.fractional_units
                                  : null
                            const nativeValue =
                              typeof position.price === "number" && typeof nativeUnits === "number"
                                ? position.price * nativeUnits
                                : null
                            const valueBase =
                              typeof position.value_base === "number"
                                ? position.value_base
                                : typeof nativeValue === "number"
                                  ? nativeValue * (typeof position.fx_to_base === "number" ? position.fx_to_base : 1)
                                  : null
                            const formattedValueBase =
                              typeof valueBase === "number"
                                ? new Intl.NumberFormat("en-US", {
                                    style: "currency",
                                    currency: baseCurrency,
                                  }).format(valueBase)
                                : ""
                            const formattedNativeValue =
                              nativeValue !== null
                                ? new Intl.NumberFormat("en-US", {
                                    style: "currency",
                                    currency: priceCurrency,
                                  }).format(nativeValue)
                                : ""
                            return (
                              <tr key={`${ticker}-${positionIdx}`} className="border-t border-slate-100">
                                <td className="py-2 pr-4">
                                  <span className="font-medium text-slate-900">{ticker}</span>
                                  {description && (
                                    <span className="block text-xs text-slate-500">{description}</span>
                                  )}
                                </td>
                                <td className="py-2 pr-4">{position.units ?? ""}</td>
                                <td className="py-2 pr-4">
                                  {formattedValueBase}
                                  {formattedNativeValue && priceCurrency !== baseCurrency && (
                                    <span className="block text-xs text-slate-500">
                                      Native: {formattedNativeValue}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                          {typeof cashAmount === "number" && (
                            <tr className="border-t border-slate-100">
                              <td className="py-2 pr-4">
                                <span className="font-medium text-slate-900">Cash</span>
                              </td>
                              <td className="py-2 pr-4"></td>
                              <td className="py-2 pr-4">
                                {typeof cashBaseAmount === "number"
                                  ? new Intl.NumberFormat("en-US", {
                                      style: "currency",
                                      currency: baseCurrency,
                                    }).format(cashBaseAmount)
                                  : null}
                                {typeof cashAmount === "number" &&
                                  cashCurrency &&
                                  cashCurrency !== baseCurrency && (
                                    <span className="block text-xs text-slate-500">
                                      Native:{" "}
                                      {new Intl.NumberFormat("en-US", {
                                        style: "currency",
                                        currency: cashCurrency ?? baseCurrency,
                                      }).format(cashAmount)}
                                    </span>
                                  )}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="flex items-center justify-end pt-3">
                    <Button
                      size="sm"
                      onClick={() => openImportModal(accountId ?? null, name)}
                      disabled={importing}
                    >
                      Import holdings
                    </Button>
                  </div>
                </div>
              )
            })}
          </section>
        )}
      </CardContent>
    </Card>

    <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import holdings</DialogTitle>
          <DialogDescription>
            Create a new portfolio from your connected broker holdings. We will save a snapshot and take you to the new
            portfolio.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="text-xs text-slate-500">From account</p>
            <p className="text-sm font-medium text-slate-800">{importAccountLabel || "Selected broker account"}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="import-name">Portfolio name</Label>
            <Input
              id="import-name"
              value={importPortfolioName}
              onChange={(e) => setImportPortfolioName(e.target.value)}
              placeholder="My portfolio"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="import-description">Description (optional)</Label>
            <Textarea
              id="import-description"
              value={importPortfolioDescription}
              onChange={(e) => setImportPortfolioDescription(e.target.value)}
              placeholder="e.g. Imported from your broker via SnapTrade"
            />
          </div>
          <div className="space-y-2">
            <Label>Base currency</Label>
            <Select value={importBaseCurrency} onValueChange={(val) => setImportBaseCurrency(val)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BASE_CURRENCY_OPTIONS.map((code) => (
                  <SelectItem key={code} value={code}>
                    {code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-500">Totals and analytics will be shown in this currency.</p>
          </div>
          {importError && <p className="text-sm text-red-600">{importError}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setImportDialogOpen(false)} disabled={importing}>
            Cancel
          </Button>
          <LoadingButton onClick={handleImportSubmit} loading={importing}>
            Import and continue
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}
