"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/ui/loading-button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Plus, Trash2, AlertCircle, Calculator } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"

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

  const router = useRouter()
  const supabase = createClient()

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

  const updateHolding = (id: string, field: keyof Holding, value: string | number) => {
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

    const validHoldings = holdings.filter((h) => h.ticker.trim() && h.weight > 0)
    if (validHoldings.length === 0) {
      setError("At least one holding with ticker and weight is required")
      return false
    }

    const totalWeight = getTotalWeight()
    if (Math.abs(totalWeight - 1) > 0.01 && Math.abs(totalWeight - 100) > 1) {
      setError("Total weights should sum to 1 (100%). Use the normalize button to auto-adjust.")
      return false
    }

    // Check for duplicate tickers
    const tickers = validHoldings.map((h) => h.ticker.toUpperCase())
    const uniqueTickers = new Set(tickers)
    if (tickers.length !== uniqueTickers.size) {
      setError("Duplicate tickers found. Each ticker should appear only once.")
      return false
    }

    return true
  }

  const handleSubmit = async () => {
    setError(null)

    if (!validateForm()) return

    setIsLoading(true)

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error("Not authenticated")

      // Create portfolio
      const { data: portfolio, error: portfolioError } = await supabase
        .from("portfolios")
        .insert({
          user_id: user.id,
          name: portfolioName.trim(),
          description: portfolioDescription.trim() || null,
        })
        .select()
        .single()

      if (portfolioError) throw portfolioError

      // Prepare holdings data
      const validHoldings = holdings.filter((h) => h.ticker.trim() && h.weight > 0)
      const totalWeight = getTotalWeight()

      const holdingsData = validHoldings.map((holding) => ({
        portfolio_id: portfolio.id,
        ticker: holding.ticker.toUpperCase().trim(),
        weight: totalWeight > 50 ? holding.weight / 100 : holding.weight, // Handle percentage vs decimal
        shares: holding.shares || null,
        purchase_price: holding.purchasePrice || null,
      }))

      const { error: holdingsError } = await supabase.from("portfolio_holdings").insert(holdingsData)

      if (holdingsError) throw holdingsError

      router.push(`/dashboard/portfolio/${portfolio.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create portfolio")
    } finally {
      setIsLoading(false)
    }
  }

  const totalWeight = getTotalWeight()
  const isWeightValid = Math.abs(totalWeight - 1) < 0.01 || Math.abs(totalWeight - 100) < 1

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Portfolio Details</CardTitle>
          <CardDescription>Enter basic information about your portfolio</CardDescription>
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
              <span className="font-medium">Total Weight:</span>
              <span
                className={`font-bold ${isWeightValid ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
              >
                {totalWeight.toFixed(2)}%
              </span>
            </div>

            {!isWeightValid && totalWeight > 0 && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Total weight should equal 100%. Current total: {totalWeight.toFixed(2)}%
                  {totalWeight > 100 && " (Use the Normalize button to auto-adjust)"}
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
        <Button variant="outline" onClick={() => router.push("/dashboard")}>
          Cancel
        </Button>
        <LoadingButton
          onClick={handleSubmit}
          loading={isLoading}
          loadingText="Creating portfolio..."
          spinnerPlacement="start"
          disabled={!portfolioName.trim() || totalWeight === 0}
        >
          Create Portfolio
        </LoadingButton>
      </div>
    </div>
  )
}
