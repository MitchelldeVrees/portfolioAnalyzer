"use client"

import type React from "react"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Upload, AlertCircle, CheckCircle2 } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"

interface ParsedHolding {
  ticker: string
  weight?: number
  shares?: number
  purchasePrice?: number
}

export function PortfolioUploadForm() {
  const [file, setFile] = useState<File | null>(null)
  const [portfolioName, setPortfolioName] = useState("")
  const [portfolioDescription, setPortfolioDescription] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [parsedData, setParsedData] = useState<ParsedHolding[] | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  const router = useRouter()
  const supabase = createClient()

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      setFile(selectedFile)
      setError(null)
      setParsedData(null)
      setShowPreview(false)
    }
  }

  const parseCSVContent = (content: string): ParsedHolding[] => {
    const lines = content.trim().split("\n")
    const headers = lines[0]
      .toLowerCase()
      .split(",")
      .map((h) => h.trim())

    // Find column indices
    const tickerIndex = headers.findIndex((h) => h.includes("ticker") || h.includes("symbol") || h.includes("stock"))
    const weightIndex = headers.findIndex(
      (h) => h.includes("weight") || h.includes("allocation") || h.includes("percent"),
    )
    const sharesIndex = headers.findIndex((h) => h.includes("shares") || h.includes("quantity") || h.includes("units"))
    const priceIndex = headers.findIndex((h) => h.includes("price") || h.includes("cost") || h.includes("purchase"))

    if (tickerIndex === -1) {
      throw new Error(
        "Could not find ticker/symbol column. Please ensure your file has a column named 'ticker', 'symbol', or 'stock'.",
      )
    }

    const holdings: ParsedHolding[] = []

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(",").map((v) => v.trim())
      if (values.length < headers.length || !values[tickerIndex]) continue

      const holding: ParsedHolding = {
        ticker: values[tickerIndex].toUpperCase(),
      }

      if (weightIndex !== -1 && values[weightIndex]) {
        const weight = Number.parseFloat(values[weightIndex].replace("%", ""))
        if (!isNaN(weight)) {
          holding.weight = weight > 1 ? weight / 100 : weight
        }
      }

      if (sharesIndex !== -1 && values[sharesIndex]) {
        const shares = Number.parseFloat(values[sharesIndex])
        if (!isNaN(shares)) {
          holding.shares = shares
        }
      }

      if (priceIndex !== -1 && values[priceIndex]) {
        const price = Number.parseFloat(values[priceIndex].replace("$", ""))
        if (!isNaN(price)) {
          holding.purchasePrice = price
        }
      }

      holdings.push(holding)
    }

    return holdings
  }

  const handlePreview = async () => {
    if (!file) return

    setIsLoading(true)
    setError(null)

    try {
      const content = await file.text()
      let parsed: ParsedHolding[]

      if (file.name.endsWith(".csv") || file.type === "text/csv") {
        parsed = parseCSVContent(content)
      } else if (file.name.endsWith(".txt") || file.type === "text/plain") {
        // Simple text parsing - assume each line is ticker,weight or ticker weight
        const lines = content.trim().split("\n")
        parsed = lines
          .map((line) => {
            const parts = line.trim().split(/[,\s]+/)
            const holding: ParsedHolding = {
              ticker: parts[0].toUpperCase(),
            }
            if (parts[1]) {
              const weight = Number.parseFloat(parts[1].replace("%", ""))
              if (!isNaN(weight)) {
                holding.weight = weight > 1 ? weight / 100 : weight
              }
            }
            return holding
          })
          .filter((h) => h.ticker)
      } else {
        throw new Error("Unsupported file type. Please upload CSV or TXT files.")
      }

      if (parsed.length === 0) {
        throw new Error("No valid holdings found in the file.")
      }

      setParsedData(parsed)
      setShowPreview(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse file")
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = async () => {
    if (!parsedData || !portfolioName.trim()) return

    setIsLoading(true)
    setError(null)

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

      // Insert holdings
      const holdings = parsedData.map((holding) => ({
        portfolio_id: portfolio.id,
        ticker: holding.ticker,
        weight: holding.weight || 0,
        shares: holding.shares || null,
        purchase_price: holding.purchasePrice || null,
      }))

      const { error: holdingsError } = await supabase.from("portfolio_holdings").insert(holdings)

      if (holdingsError) throw holdingsError

      router.push(`/dashboard/portfolio/${portfolio.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create portfolio")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Upload className="w-5 h-5" />
            <span>Upload Portfolio File</span>
          </CardTitle>
          <CardDescription>
            Supported formats: CSV, TXT. Your file should contain ticker symbols and optionally weights, shares, or
            purchase prices.
          </CardDescription>
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

          <div className="space-y-2">
            <Label htmlFor="file">Portfolio File</Label>
            <Input id="file" type="file" accept=".csv,.txt" onChange={handleFileChange} className="cursor-pointer" />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              CSV format: ticker,weight,shares,price (headers required)
              <br />
              TXT format: ticker weight (space or comma separated)
            </p>
          </div>

          {file && !showPreview && (
            <Button onClick={handlePreview} disabled={isLoading} className="w-full">
              {isLoading ? "Parsing..." : "Preview Data"}
            </Button>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {showPreview && parsedData && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              <span>Preview ({parsedData.length} holdings)</span>
            </CardTitle>
            <CardDescription>Review your portfolio data before creating</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-64 overflow-y-auto border rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800 sticky top-0">
                  <tr>
                    <th className="text-left p-2 border-b">Ticker</th>
                    <th className="text-left p-2 border-b">Weight</th>
                    <th className="text-left p-2 border-b">Shares</th>
                    <th className="text-left p-2 border-b">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedData.map((holding, index) => (
                    <tr key={index} className="border-b">
                      <td className="p-2 font-mono">{holding.ticker}</td>
                      <td className="p-2">{holding.weight ? `${(holding.weight * 100).toFixed(2)}%` : "-"}</td>
                      <td className="p-2">{holding.shares || "-"}</td>
                      <td className="p-2">{holding.purchasePrice ? `$${holding.purchasePrice.toFixed(2)}` : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between mt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setShowPreview(false)
                  setParsedData(null)
                }}
              >
                Edit File
              </Button>
              <Button onClick={handleSubmit} disabled={isLoading || !portfolioName.trim()}>
                {isLoading ? "Creating Portfolio..." : "Create Portfolio"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
