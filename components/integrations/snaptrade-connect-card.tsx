"use client"

import { useEffect, useMemo, useState } from "react"
import { withCsrfHeaders } from "@/lib/security/csrf-client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LoadingButton } from "@/components/ui/loading-button"
import { Input } from "@/components/ui/input"

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
  price?: number | null
  symbol?: {
    symbol?: {
      symbol?: string
      raw_symbol?: string
      description?: string | null
    }
  }
}

type SnaptradeAccountHolding = {
  account?: {
    id?: string
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
  positions?: SnaptradePosition[] | null
  balances?: Array<{
    currency?: string | null
    cash?: number | null
  }>
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
  const [brokerages, setBrokerages] = useState<SnaptradeBrokerage[]>([])
  const [loadingBrokers, setLoadingBrokers] = useState(false)
  const [connectingSlug, setConnectingSlug] = useState<string | null>(null)
  const [connections, setConnections] = useState<SnaptradeConnection[]>([])
  const [loadingConnections, setLoadingConnections] = useState(false)
  const [holdings, setHoldings] = useState<SnaptradeAccountHolding[]>([])
  const [loadingHoldings, setLoadingHoldings] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const [pendingBroker, setPendingBroker] = useState<string | null>(null)
  const [pendingMessage, setPendingMessage] = useState<string | null>(null)
  const [snaptradeSummary, setSnaptradeSummary] = useState<{ total: number; currency?: string | null } | null>(null)
  const [autoSyncTriggered, setAutoSyncTriggered] = useState(false)
  const pageSize = 9

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
      await fetchConnections()
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

  const fetchHoldings = async () => {
    setLoadingHoldings(true)
    try {
      const response = await fetch("/api/integrations/snaptrade/holdings")
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to load holdings")
      }
      const data = payload?.holdings
      const summary = payload?.summary
      if (summary && typeof summary.total === "number") {
        setSnaptradeSummary({
          total: summary.total,
          currency: summary.currency ?? undefined,
        })
      } else {
        setSnaptradeSummary(null)
      }
      if (Array.isArray(data)) {
        setHoldings(data)
      } else if (data && Array.isArray(data.accounts)) {
        setHoldings(data.accounts)
      } else {
        setHoldings([])
      }
      setError(null)
      setLastSyncedAt(new Date())
    } catch (err) {
      setHoldings([])
      setLastSyncedAt(null)
      setError(err instanceof Error ? err.message : "Failed to load holdings")
      setSnaptradeSummary(null)
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
      setError(null)
      await fetchConnections()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open SnapTrade portal")
    } finally {
      setConnectingSlug(null)
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
    if (!snaptradeSummary || typeof snaptradeSummary.total !== "number") return null
    try {
      const currency = snaptradeSummary.currency ?? "USD"
      return new Intl.NumberFormat(navigator.language, { style: "currency", currency }).format(
        snaptradeSummary.total,
      )
    } catch {
      return `${snaptradeSummary.total.toFixed(2)}${snaptradeSummary.currency ? ` ${snaptradeSummary.currency}` : ""}`
    }
  }, [snaptradeSummary])

  const totalPages = Math.max(1, Math.ceil(filteredBrokerages.length / pageSize))
  const pagedBrokerages = filteredBrokerages.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages))
  }, [totalPages])


  return (
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

        {connections.length > 0 && (
          <section className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
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
                  {loadingConnections ? "Refreshing..." : "Refresh status"}
                </Button>
                <LoadingButton
                  variant="secondary"
                  size="sm"
                  loading={loadingHoldings}
                  onClick={fetchHoldings}
                >
                  {loadingHoldings ? "Fetching holdings..." : "Fetch holdings"}
                </LoadingButton>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {connections.map((connection) => (
                <div
                  key={connection.id}
                  className="rounded-md border border-white bg-white/80 px-4 py-3 shadow-sm"
                >
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
                      Awaiting brokerage confirmation. You can still start new connections meanwhile.
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
            {holdings.map((account, idx) => {
              const name =
                account.account?.name || account.account?.number || `Linked account ${idx + 1}`
                console.log('account', account);
              const positions = Array.isArray(account.positions) ? account.positions.slice(0, 5) : []
              const totalValue = account.total_value.value ?? null
              const totalCurrency = account.total_value.currency ?? snaptradeSummary?.currency ?? "USD"
              const formattedValue =
                typeof totalValue === "number"
                  ? new Intl.NumberFormat("en-US", { style: "currency", currency: totalCurrency ?? "USD" }).format(
                      totalValue,
                    )
                  : null
              return (
                <div key={`${account.account?.id ?? idx}`} className="rounded-lg border border-slate-200 p-4 space-y-3">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-slate-900">{name}</p>
                      {formattedValue && (
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {formattedValue}
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
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="text-left text-slate-500">
                            <th className="pb-1 pr-4">Symbol</th>
                            <th className="pb-1 pr-4">Units</th>
                            <th className="pb-1 pr-4">Last price</th>
                          </tr>
                        </thead>
                        <tbody>
                          {positions.map((position, positionIdx) => {
                            const ticker =
                              position.symbol?.symbol?.symbol ??
                              position.symbol?.symbol?.raw_symbol ??
                              ""
                            const description = position.symbol?.symbol?.description ?? ""
                            return (
                              <tr key={`${ticker}-${positionIdx}`} className="border-t border-slate-100">
                                <td className="py-2 pr-4">
                                  <span className="font-medium text-slate-900">{ticker}</span>
                                  {description && <span className="block text-xs text-slate-500">{description}</span>}
                                </td>
                                <td className="py-2 pr-4">{position.units ?? ""}</td>
                                <td className="py-2 pr-4">
                                  {typeof position.price === "number" ? `$${position.price.toFixed(2)}` : ""}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </section>
        )}
      </CardContent>
    </Card>
  )
}
