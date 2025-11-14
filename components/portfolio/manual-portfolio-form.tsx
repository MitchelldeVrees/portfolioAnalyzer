"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/ui/loading-button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Plus, Trash2, AlertCircle, Calculator } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { TickerAutocomplete } from "./ticker-autocomplete"
import { withCsrfHeaders } from "@/lib/security/csrf-client"

interface Holding {
  id: string
  ticker: string
  weight: number
  shares?: number
  purchasePrice?: number
}

export function ManualPortfolioForm() {
  const [portfolioName, setPortfolioName] = useState("")
  const [portfolioDescription, setPortfolioDescription] = useState("")
  const [holdings, setHoldings] = useState<Holding[]>([{ id: "1", ticker: "", weight: 0 }])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showMinimalInfoPrompt, setShowMinimalInfoPrompt] = useState(false)
  const [hasAcknowledgedMinimalInfo, setHasAcknowledgedMinimalInfo] = useState(false)

  const router = useRouter()

  const holdingsWithTickers = holdings.filter((holding) => holding.ticker.trim().length > 0)
  const hasAnyTickers = holdingsWithTickers.length > 0
  const hasAdditionalHoldingDetails = holdingsWithTickers.some(
    (holding) =>
      holding.weight > 0 ||
      (holding.shares ?? 0) > 0 ||
      (holding.purchasePrice ?? 0) > 0,
  )
  const shouldWarnMinimalInfo = hasAnyTickers && !hasAdditionalHoldingDetails

  useEffect(() => {
    if (!shouldWarnMinimalInfo) {
      setShowMinimalInfoPrompt(false)
      setHasAcknowledgedMinimalInfo(false)
    }
  }, [shouldWarnMinimalInfo])

  const addHolding = () => {
    const newHolding: Holding = {
      id: Date.now().toString(),
      ticker: "",
      weight: 0,
    }
    setHoldings([...holdings, newHolding])
  }

  const removeHolding = (id: string) => {
    if (holdings.length > 1) {
      setHoldings(holdings.filter((h) => h.id !== id))
    }
  }

  const updateHolding = (id: string, field: keyof Holding, value: string | number | undefined) => {
    setHoldings(holdings.map((h) => (h.id === id ? { ...h, [field]: value } : h)))
  }

  const normalizeWeights = () => {
    const totalWeight = holdings.reduce((sum, h) => sum + (h.weight || 0), 0)
    if (totalWeight === 0) return

    setHoldings(
      holdings.map((h) => ({
        ...h,
        weight: (h.weight || 0) / totalWeight,
      })),
    )
  }

  const getTotalWeight = () => {
    return holdings.reduce((sum, h) => sum + (h.weight || 0), 0)
  }

  const validateForm = () => {
    if (!portfolioName.trim()) {
      setError("Portfolio name is required")
      return false
    }

    const validHoldings = holdings.filter((h) => h.ticker.trim())
    if (validHoldings.length === 0) {
      setError("Add at least one ticker symbol to continue")
      return false
    }

    const tickers = validHoldings.map((h) => h.ticker.trim().toUpperCase())
    const uniqueTickers = new Set(tickers)
    if (tickers.length !== uniqueTickers.size) {
      setError("Duplicate tickers found. Each ticker should appear only once.")
      return false
    }

    const hasWeights = validHoldings.some((h) => h.weight > 0)
    if (hasWeights) {
      const totalWeight = getTotalWeight()
      const weightsAreBalanced = Math.abs(totalWeight - 1) < 0.01 || Math.abs(totalWeight - 100) < 1
      if (!weightsAreBalanced) {
        setError("When weights are provided they should total 100%. Use Normalize to auto-adjust.")
        return false
      }
    }

    return true
  }

  const submitPortfolio = async () => {
    setIsLoading(true)

    try {
      const validHoldings = holdings.filter((h) => h.ticker.trim())
      const totalWeight = getTotalWeight()

      const response = await fetch(
        "/api/portfolios",
        withCsrfHeaders({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: portfolioName.trim(),
            description: portfolioDescription.trim() || undefined,
            holdings: validHoldings.map((holding) => {
              const hasWeight = holding.weight > 0
              const normalizedWeight =
                hasWeight && totalWeight > 50 ? holding.weight / 100 : holding.weight

              return {
                ticker: holding.ticker.toUpperCase().trim(),
                weight: hasWeight ? normalizedWeight : undefined,
                shares: holding.shares ?? null,
                purchasePrice: holding.purchasePrice ?? null,
              }
            }),
          }),
        }),
      )

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to create portfolio")
      }

      router.push(`/dashboard/portfolio/${payload.portfolioId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create portfolio")
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = async () => {
    setError(null)

    if (!validateForm()) return

    if (shouldWarnMinimalInfo && !hasAcknowledgedMinimalInfo) {
      setShowMinimalInfoPrompt(true)
      return
    }

    await submitPortfolio()
  }

  const handleMinimalInfoContinue = async () => {
    setShowMinimalInfoPrompt(false)
    setHasAcknowledgedMinimalInfo(true)
    await handleSubmit()
  }

  const totalWeight = getTotalWeight()
  const hasAnyWeightInputs = holdings.some((holding) => holding.weight > 0)
  const isWeightValid =
    !hasAnyWeightInputs || Math.abs(totalWeight - 1) < 0.01 || Math.abs(totalWeight - 100) < 1
  const displayTotalWeight =
    hasAnyWeightInputs && totalWeight <= 1 ? totalWeight * 100 : totalWeight

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Portfolio Details</CardTitle>
          <CardDescription>Enter basic information about your portfolio. Weights are optional but help improve analytics.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="portfolioName">Portfolio Name</Label>
            <Input
              id="portfolioName"
              placeholder="My Investment Portfolio"
              value={portfolioName}
              onChange={(e) => setPortfolioName(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="portfolioDescription">Description (Optional)</Label>
            <Textarea
              id="portfolioDescription"
              placeholder="Describe your portfolio strategy or goals..."
              value={portfolioDescription}
              onChange={(e) => setPortfolioDescription(e.target.value)}
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Holdings</CardTitle>
              <CardDescription>Add your portfolio holdings with ticker symbols and weights</CardDescription>
            </div>
            <div className="flex items-center space-x-2">
              <Button variant="outline" size="sm" onClick={normalizeWeights}>
                <Calculator className="w-4 h-4 mr-2" />
                Normalize
              </Button>
              <Button onClick={addHolding} size="sm">
                <Plus className="w-4 h-4 mr-2" />
                Add Holding
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {holdings.map((holding, index) => (
              <div key={holding.id} className="grid grid-cols-12 gap-4 items-end p-4 border rounded-lg">
                <div className="col-span-3">
                  <Label htmlFor={`ticker-${holding.id}`}>Ticker Symbol</Label>
                  <TickerAutocomplete
                    value={holding.ticker}
                    onChange={(value) => updateHolding(holding.id, "ticker", value)}
                    placeholder="Search tickers..."
                    className="font-mono"
                  />
                </div>

                <div className="col-span-2">
                  <Label htmlFor={`weight-${holding.id}`} className="flex items-center justify-between gap-2">
                    <span>Weight (%)</span>
                    <span className="text-xs font-normal text-slate-500 dark:text-slate-400">Optional</span>
                  </Label>
                  <Input
                    id={`weight-${holding.id}`}
                    type="number"
                    placeholder="10"
                    min="0"
                    max="100"
                    step="0.01"
                    value={holding.weight || ""}
                    onChange={(e) => updateHolding(holding.id, "weight", Number.parseFloat(e.target.value) || 0)}
                  />
                </div>

                <div className="col-span-3">
                  <Label htmlFor={`shares-${holding.id}`}>Shares (Optional)</Label>
                  <Input
                    id={`shares-${holding.id}`}
                    type="number"
                    placeholder="100"
                    min="0"
                    step="0.001"
                    value={holding.shares || ""}
                    onChange={(e) =>
                      updateHolding(holding.id, "shares", Number.parseFloat(e.target.value) || undefined)
                    }
                  />
                </div>

                <div className="col-span-3">
                  <Label htmlFor={`price-${holding.id}`}>Purchase Price (Optional)</Label>
                  <Input
                    id={`price-${holding.id}`}
                    type="number"
                    placeholder="150.00"
                    min="0"
                    step="0.01"
                    value={holding.purchasePrice || ""}
                    onChange={(e) =>
                      updateHolding(holding.id, "purchasePrice", Number.parseFloat(e.target.value) || undefined)
                    }
                  />
                </div>

                <div className="col-span-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => removeHolding(holding.id)}
                    disabled={holdings.length === 1}
                    className="w-full"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}

            <div className="flex justify-between items-center p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
              <span className="font-medium">
                Total Weight <span className="ml-1 text-sm font-normal text-slate-500 dark:text-slate-400">(optional)</span>
              </span>
              <span
                className={`font-bold ${
                  !hasAnyWeightInputs
                    ? "text-slate-500 dark:text-slate-300"
                    : isWeightValid
                    ? "text-green-600 dark:text-green-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                {displayTotalWeight.toFixed(2)}%
              </span>
            </div>

            {!isWeightValid && hasAnyWeightInputs && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Weights are optional, but when you provide them they should total 100%. Current total:{" "}
                  {displayTotalWeight.toFixed(2)}%
                  {displayTotalWeight > 100 && " (Use the Normalize button to auto-adjust)"}
                </AlertDescription>
              </Alert>
            )}
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {showMinimalInfoPrompt && (
        <Alert className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/10 dark:text-amber-100">
          <AlertCircle className="h-4 w-4" />
          <div className="flex flex-col gap-3">
            <AlertDescription>
              We recommend adding weights, share counts, or purchase prices so your analysis is more accurate.
              You can still continue with only tickers if you want.
            </AlertDescription>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowMinimalInfoPrompt(false)}>
                I&apos;ll add details
              </Button>
              <Button size="sm" onClick={handleMinimalInfoContinue}>
                Continue anyway
              </Button>
            </div>
          </div>
        </Alert>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => router.push("/dashboard")}>
          Cancel
        </Button>
        <LoadingButton
          onClick={handleSubmit}
          loading={isLoading}
          loadingText="Creating portfolio..."
          spinnerPlacement="start"
          disabled={!portfolioName.trim() || !hasAnyTickers}
        >
          Create Portfolio
        </LoadingButton>
      </div>
    </div>
  )
}
