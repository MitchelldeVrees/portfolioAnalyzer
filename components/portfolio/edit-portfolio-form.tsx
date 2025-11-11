"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Plus, Trash2, AlertCircle, Calculator, Save } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { withCsrfHeaders } from "@/lib/security/csrf-client"

type DBHolding = {
  id: string
  ticker: string
  weight: number // decimal 0..1 in DB
  shares: number | null
  purchase_price: number | null
}

type DBPortfolio = {
  id: string
  name: string
  description: string | null
  portfolio_holdings: DBHolding[]
}

type Holding = {
  id: string
  ticker: string
  weight: number // stored in UI as percentage 0..100 for input convenience
  shares?: number
  purchasePrice?: number
}

export function EditPortfolioForm({ portfolio }: { portfolio: DBPortfolio }) {
  const router = useRouter()

  const [portfolioName, setPortfolioName] = useState("")
  const [portfolioDescription, setPortfolioDescription] = useState<string>("")
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Initialize from props
  useEffect(() => {
    setPortfolioName(portfolio.name)
    setPortfolioDescription(portfolio.description ?? "")
    setHoldings(
      (portfolio.portfolio_holdings || []).map((h) => ({
        id: h.id,
        ticker: h.ticker || "",
        weight: typeof h.weight === "number" ? h.weight * 100 : 0, // convert decimal -> percent
        shares: (h.shares ?? undefined) as number | undefined,
        purchasePrice: (h.purchase_price ?? undefined) as number | undefined,
      })),
    )
  }, [portfolio])

  const addHolding = () => {
    setHoldings((prev) => [
      ...prev,
      { id: Date.now().toString(), ticker: "", weight: 0, shares: undefined, purchasePrice: undefined },
    ])
  }

  const removeHolding = (id: string) => {
    setHoldings((prev) => (prev.length > 1 ? prev.filter((h) => h.id !== id) : prev))
  }

  const updateHolding = (id: string, field: keyof Holding, value: string | number | undefined) => {
    setHoldings((prev) => prev.map((h) => (h.id === id ? { ...h, [field]: value } : h)))
  }

  const totalWeight = useMemo(() => holdings.reduce((sum, h) => sum + (h.weight || 0), 0), [holdings])
  const isWeightValid = Math.abs(totalWeight - 100) < 1 || Math.abs(totalWeight - 1) < 0.01

  const normalizeWeights = () => {
    const total = holdings.reduce((sum, h) => sum + (h.weight || 0), 0)
    if (total === 0) return
    setHoldings((prev) => prev.map((h) => ({ ...h, weight: (h.weight || 0) / total * 100 })))
  }

  const validateForm = () => {
    if (!portfolioName.trim()) {
      setError("Portfolio name is required")
      return false
    }
    const valid = holdings.filter((h) => h.ticker.trim() && (h.weight ?? 0) > 0)
    if (valid.length === 0) {
      setError("At least one holding with ticker and weight is required")
      return false
    }
    const tickers = valid.map((h) => h.ticker.toUpperCase())
    const unique = new Set(tickers)
    if (tickers.length !== unique.size) {
      setError("Duplicate tickers found. Each ticker should appear only once.")
      return false
    }
    return true
  }

  const handleSave = async () => {
    setError(null)
    if (!validateForm()) return
    setIsSaving(true)
    try {
      const prepared = holdings
        .filter((h) => h.ticker.trim() && (h.weight ?? 0) > 0)
        .map((h) => ({
          ticker: h.ticker.toUpperCase().trim(),
          weight: totalWeight > 50 ? (h.weight || 0) / 100 : h.weight || 0,
          shares: h.shares ?? null,
          purchasePrice: h.purchasePrice ?? null,
        }))

      const response = await fetch(
        `/api/portfolios/${portfolio.id}`,
        withCsrfHeaders({
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: portfolioName.trim(),
            description: portfolioDescription.trim() || undefined,
            holdings: prepared,
          }),
        }),
      )

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to update portfolio")
      }

      router.push(`/dashboard/portfolio/${portfolio.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save portfolio changes")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Portfolio Details</CardTitle>
          <CardDescription>Update your portfolio information</CardDescription>
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
              <CardDescription>Edit tickers, weights, and optional details</CardDescription>
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
            {holdings.map((holding) => (
              <div key={holding.id} className="grid grid-cols-12 gap-4 items-end p-4 border rounded-lg">
                <div className="col-span-3">
                  <Label htmlFor={`ticker-${holding.id}`}>Ticker</Label>
                  <Input
                    id={`ticker-${holding.id}`}
                    placeholder="AAPL"
                    value={holding.ticker}
                    onChange={(e) => updateHolding(holding.id, "ticker", e.target.value.toUpperCase())}
                    className="font-mono"
                  />
                </div>

                <div className="col-span-2">
                  <Label htmlFor={`weight-${holding.id}`}>Weight (%)</Label>
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
                    value={holding.shares ?? ""}
                    onChange={(e) => updateHolding(holding.id, "shares", Number.parseFloat(e.target.value) || undefined)}
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
                    value={holding.purchasePrice ?? ""}
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
              <span className="font-medium">Total Weight:</span>
              <span className={`font-bold ${isWeightValid ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                {totalWeight.toFixed(2)}%
              </span>
            </div>

            {!isWeightValid && totalWeight > 0 && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Total weight should equal 100%. Current total: {totalWeight.toFixed(2)}%
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

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => router.push(`/dashboard/portfolio/${portfolio.id}`)}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={isSaving || !portfolioName.trim()}>
          <Save className="w-4 h-4 mr-2" />
          {isSaving ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </div>
  )
}
