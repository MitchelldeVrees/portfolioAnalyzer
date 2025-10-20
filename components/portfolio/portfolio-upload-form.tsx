"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/ui/loading-button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Upload, AlertCircle, CheckCircle2 } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

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
  const [headers, setHeaders] = useState<string[]>([]) // Original case headers for display
  const [mappings, setMappings] = useState<ColumnMappings>({
    ticker: "",
    weight: "",
    shares: "",
    purchasePrice: "",
  })
  const [fileContent, setFileContent] = useState<string>("") // Store file content to avoid re-reading
  const [isCSV, setIsCSV] = useState(false)

  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    if (fileContent && mappings.ticker && isCSV) {
      setIsLoading(true)
      try {
        const parsed = parseCSVContent(fileContent, mappings)
        if (parsed.length > 0) {
          setParsedData(parsed)
          setError(null)
        } else {
          setParsedData(null)
          setError("No valid holdings found in the file.")
        }
      } catch (err) {
        setParsedData(null)
        setError(err instanceof Error ? err.message : "Failed to parse file")
      } finally {
        setIsLoading(false)
      }
    } else if (parsedData && !mappings.ticker) {
      setParsedData(null)
    }
  }, [mappings, fileContent, isCSV])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      setFile(selectedFile)
      setError(null)
      setParsedData(null)
      setShowPreview(false)
      setHeaders([])
      setMappings({
        ticker: "",
        weight: "",
        shares: "",
        purchasePrice: "",
      })
      setFileContent("")
      setIsCSV(false)
    }
  }

  const parseCSVContent = (content: string, columnMap: ColumnMappings): ParsedHolding[] => {
    const lines = content.trim().split("\n")
    const rawHeaders = lines[0].split(",").map((h) => h.trim())
    const lowerHeaders = rawHeaders.map((h) => h.toLowerCase())

    // Find column indices based on mappings
    const tickerIndex = lowerHeaders.findIndex((h) => h === columnMap.ticker.toLowerCase())
    const weightIndex = mappings.weight
      ? lowerHeaders.findIndex((h) => h === mappings.weight.toLowerCase())
      : -1
    const sharesIndex = mappings.shares
      ? lowerHeaders.findIndex((h) => h === mappings.shares.toLowerCase())
      : -1
    const priceIndex = mappings.purchasePrice
      ? lowerHeaders.findIndex((h) => h === mappings.purchasePrice.toLowerCase())
      : -1

    if (tickerIndex === -1) {
      throw new Error("Ticker column is required. Please select a column for ticker.")
    }

    const holdings: ParsedHolding[] = []

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(",").map((v) => v.trim())
      if (values.length < rawHeaders.length || !values[tickerIndex]) continue

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

  const handleLoadHeaders = async () => {
    if (!file) return

    setIsLoading(true)
    setError(null)

    try {
      const content = await file.text()
      setFileContent(content)

      let parsed: ParsedHolding[] | undefined

      if (file.name.endsWith(".csv") || file.type === "text/csv") {
        const lines = content.trim().split("\n")
        if (lines.length < 1) {
          throw new Error("Empty file.")
        }
        const rawHeaders = lines[0].split(",").map((h) => h.trim())
        setHeaders(rawHeaders)
        setIsCSV(true)

        // Auto-guess mappings based on names
        const lowerHeaders = rawHeaders.map((h) => h.toLowerCase())
        let ticker = ""
        let weight = ""
        let purchasePrice = ""
        let shares = ""

        const tickerIdx = lowerHeaders.findIndex(
          (h) => h.includes("ticker") || h.includes("symbol") || h.includes("stock")
        )
        if (tickerIdx !== -1) ticker = rawHeaders[tickerIdx]

        const weightIdx = lowerHeaders.findIndex(
          (h) => h.includes("weight") || h.includes("allocation") || h.includes("percent") || h.includes("percentage")
        )
        if (weightIdx !== -1) weight = rawHeaders[weightIdx]

        const sharesIdx = lowerHeaders.findIndex(
          (h) => h.includes("shares") || h.includes("quantity") || h.includes("units") || h.includes("amount")
        )
        if (sharesIdx !== -1) shares = rawHeaders[sharesIdx]

        const priceIdx = lowerHeaders.findIndex(
          (h) => h.includes("price") || h.includes("cost") || h.includes("purchase") || h.includes("share price")
        )
        if (priceIdx !== -1) purchasePrice = rawHeaders[priceIdx]

        // Fallback to positions if not set
        if (!ticker && rawHeaders.length >= 1) ticker = rawHeaders[0]
        if (!weight && rawHeaders.length >= 2) weight = rawHeaders[1]
        if (!purchasePrice && rawHeaders.length >= 3) purchasePrice = rawHeaders[2]
        if (!shares && rawHeaders.length >= 4) shares = rawHeaders[3]

        setMappings({
          ticker,
          weight,
          shares,
          purchasePrice,
        })

        setShowPreview(true)
      } else if (file.name.endsWith(".txt") || file.type === "text/plain") {
        // Simple text parsing - assume each line is ticker percentage share_price shares
        const lines = content.trim().split("\n")
        parsed = lines
          .map((line) => {
            const parts = line.trim().split(/[,\s]+/)
            const holding: ParsedHolding = {
              ticker: parts[0]?.toUpperCase() ?? "",
            }
            if (parts[1]) {
              const weight = Number.parseFloat(parts[1].replace("%", ""))
              if (!isNaN(weight)) {
                holding.weight = weight > 1 ? weight / 100 : weight
              }
            }
            if (parts[2]) {
              const price = Number.parseFloat(parts[2].replace("$", ""))
              if (!isNaN(price)) {
                holding.purchasePrice = price
              }
            }
            if (parts[3]) {
              const shares = Number.parseFloat(parts[3])
              if (!isNaN(shares)) {
                holding.shares = shares
              }
            }
            return holding
          })
          .filter((h) => h.ticker)
        if (parsed.length === 0) {
          throw new Error("No valid holdings found in the file.")
        }
        setParsedData(parsed)
        setShowPreview(true)
        setIsCSV(false)
      } else {
        throw new Error("Unsupported file type. Please upload CSV or TXT files.")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process file")
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

  const updateMapping = (field: keyof ColumnMappings, value: string) => {
    setMappings((prev) => ({ ...prev, [field]: value }))
  }

  const getOptionalValue = (field: keyof ColumnMappings) => {
    const value = mappings[field]
    return value === "" ? "none" : value
  }

  const handleOptionalChange = (field: keyof ColumnMappings, value: string) => {
    updateMapping(field, value === "none" ? "" : value)
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
              CSV format: Recommended column order: Ticker, Percentage, Share Price, Shares - map as needed
              <br />
              TXT format: ticker percentage share_price shares (space or comma separated, optional fields)
            </p>
          </div>

          {file && !showPreview && (
            <Button onClick={handleLoadHeaders} disabled={isLoading} className="w-full">
              {isLoading ? "Loading..." : "Load File"}
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

      {showPreview && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              <span>Preview {parsedData ? `(${parsedData.length} holdings)` : ""}</span>
            </CardTitle>
            <CardDescription>Review your portfolio data before creating</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-64 overflow-y-auto border rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800 sticky top-0">
                  <tr>
                    {isCSV ? (
                      <>
                        <th className="text-left p-2 border-b">
                          <Select value={mappings.ticker} onValueChange={(v) => updateMapping("ticker", v)}>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select Ticker" />
                            </SelectTrigger>
                            <SelectContent>
                              {headers.map((header) => (
                                <SelectItem key={header} value={header}>
                                  {header}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </th>
                        <th className="text-left p-2 border-b">
                          <Select value={getOptionalValue("weight")} onValueChange={(v) => handleOptionalChange("weight", v)}>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select Percentage" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">None</SelectItem>
                              {headers.map((header) => (
                                <SelectItem key={header} value={header}>
                                  {header}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </th>
                        <th className="text-left p-2 border-b">
                          <Select value={getOptionalValue("purchasePrice")} onValueChange={(v) => handleOptionalChange("purchasePrice", v)}>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select Share Price" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">None</SelectItem>
                              {headers.map((header) => (
                                <SelectItem key={header} value={header}>
                                  {header}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </th>
                        <th className="text-left p-2 border-b">
                          <Select value={getOptionalValue("shares")} onValueChange={(v) => handleOptionalChange("shares", v)}>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select Shares" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">None</SelectItem>
                              {headers.map((header) => (
                                <SelectItem key={header} value={header}>
                                  {header}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </th>
                      </>
                    ) : (
                      <>
                        <th className="text-left p-2 border-b">Ticker</th>
                        <th className="text-left p-2 border-b">Percentage</th>
                        <th className="text-left p-2 border-b">Share Price</th>
                        <th className="text-left p-2 border-b">Shares</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {parsedData && parsedData.length > 0 ? (
                    parsedData.map((holding, index) => (
                      <tr key={index} className="border-b">
                        <td className="p-2 font-mono">{holding.ticker}</td>
                        <td className="p-2">{holding.weight ? `${(holding.weight * 100).toFixed(2)}%` : "-"}</td>
                        <td className="p-2">{holding.purchasePrice ? `$${holding.purchasePrice.toFixed(2)}` : "-"}</td>
                        <td className="p-2">{holding.shares || "-"}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="p-2 text-center text-slate-500">
                        {isCSV ? "Select columns to preview data" : "No data available"}
                      </td>
                    </tr>
                  )}
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
                Change File
              </Button>
              <LoadingButton
                onClick={handleSubmit}
                loading={isLoading}
                loadingText="Creating portfolio..."
                spinnerPlacement="start"
                disabled={!parsedData || !portfolioName.trim()}
              >
                Create Portfolio
              </LoadingButton>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}