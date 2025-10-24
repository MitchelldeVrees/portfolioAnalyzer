"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import {
  buildInitialColumnMappings,
  buildTickerCandidateList,
  detectIdentifierColumns,
  type ColumnMappings,
  type IdentifierColumnGuesses,
  type HoldingIdentifiers,
} from "@/lib/upload-parsing"
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

type HoldingResolutionMeta = {
  resolvedTicker: string
  source: string
  confidence: number
  usedIdentifier?: string
  note?: string
}

interface ParsedHolding {
  rowNumber: number
  rawTicker: string
  ticker: string
  candidates: string[]
  identifiers: HoldingIdentifiers
  weight?: number
  shares?: number
  purchasePrice?: number
  resolution?: HoldingResolutionMeta
}

type TickerResolutionRecord = {
  rowNumber: number
  rawTicker: string
  resolvedTicker: string
  source: string
  confidence: number
  usedIdentifier?: string
  note?: string
  attempted?: string[]
}

type TickerResolutionIssue = {
  rowNumber: number
  rawTicker: string
  reason: string
  attempted?: string[]
}

type TickerResolutionResponse = {
  resolved: TickerResolutionRecord[]
  unresolved: TickerResolutionIssue[]
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
  const [identifierColumns, setIdentifierColumns] = useState<IdentifierColumnGuesses>({})
  const [resolutionSummary, setResolutionSummary] = useState<string | null>(null)

  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    if (fileContent && mappings.ticker && isCSV) {
      setIsLoading(true)
      try {
        const parsed = parseCSVContent(fileContent, mappings, identifierColumns)
        if (parsed.length > 0) {
          setParsedData(parsed)
          setError(null)
          setResolutionSummary(null)
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
  }, [mappings, fileContent, isCSV, identifierColumns])

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
      setIdentifierColumns({})
      setFileContent("")
      setIsCSV(false)
      setResolutionSummary(null)
    }
  }

  const parseCSVContent = (
    content: string,
    columnMap: ColumnMappings,
    identifierColumnMap: IdentifierColumnGuesses,
  ): ParsedHolding[] => {
    const lines = content.trim().split(/\r?\n/)
    if (!lines.length) return []

    const rawHeaders = lines[0].split(",").map((h) => h.trim())
    const lowerHeaders = rawHeaders.map((h) => h.toLowerCase())
    const findIndex = (headerName?: string) => {
      if (!headerName) return -1
      const target = headerName.toLowerCase()
      return lowerHeaders.findIndex((value) => value === target)
    }

    const tickerIndex = findIndex(columnMap.ticker)
    if (tickerIndex === -1) {
      throw new Error("Ticker column is required. Please select a column for ticker.")
    }

    const weightIndex = columnMap.weight ? findIndex(columnMap.weight) : -1
    const sharesIndex = columnMap.shares ? findIndex(columnMap.shares) : -1
    const priceIndex = columnMap.purchasePrice ? findIndex(columnMap.purchasePrice) : -1

    const identifierIndices: Record<keyof HoldingIdentifiers, number> = {
      isin: findIndex(identifierColumnMap.isin),
      cusip: findIndex(identifierColumnMap.cusip),
      sedol: findIndex(identifierColumnMap.sedol),
      figi: findIndex(identifierColumnMap.figi),
      name: findIndex(identifierColumnMap.name),
      country: findIndex(identifierColumnMap.country),
    }

    const holdings: ParsedHolding[] = []

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(",").map((v) => v.trim())
      if (!values[tickerIndex]) continue

      const rawTickerValue = values[tickerIndex] ?? ""
      const tickerCandidates = buildTickerCandidateList(rawTickerValue)

      const identifiers: HoldingIdentifiers = {}
      ;(Object.keys(identifierIndices) as Array<keyof HoldingIdentifiers>).forEach((key) => {
        const index = identifierIndices[key]
        if (index >= 0 && index < values.length && values[index]) {
          identifiers[key] = values[index]?.trim() || ""
        }
      })

      const holding: ParsedHolding = {
        rowNumber: i,
        rawTicker: rawTickerValue,
        ticker: tickerCandidates.primary ?? rawTickerValue.toUpperCase(),
        candidates: tickerCandidates.candidates,
        identifiers,
      }

      if (weightIndex !== -1 && weightIndex < values.length && values[weightIndex]) {
        const weight = Number.parseFloat(values[weightIndex].replace("%", ""))
        if (!Number.isNaN(weight)) {
          holding.weight = weight > 1 ? weight / 100 : weight
        }
      }

      if (sharesIndex !== -1 && sharesIndex < values.length && values[sharesIndex]) {
        const shares = Number.parseFloat(values[sharesIndex])
        if (!Number.isNaN(shares)) {
          holding.shares = shares
        }
      }

      if (priceIndex !== -1 && priceIndex < values.length && values[priceIndex]) {
        const price = Number.parseFloat(values[priceIndex].replace("$", ""))
        if (!Number.isNaN(price)) {
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
    setResolutionSummary(null)

    try {
      const content = await file.text()
      setFileContent(content)

      let parsed: ParsedHolding[] | undefined

      if (file.name.endsWith(".csv") || file.type === "text/csv") {
        const lines = content.trim().split(/\r?\n/)
        if (lines.length < 1) {
          throw new Error("Empty file.")
        }
        const rawHeaders = lines[0].split(",").map((h) => h.trim())
        setHeaders(rawHeaders)
        setIsCSV(true)

        const initialMappings = buildInitialColumnMappings(rawHeaders)
        setMappings(initialMappings)

        const idGuesses = detectIdentifierColumns(rawHeaders)
        setIdentifierColumns(idGuesses)

        setShowPreview(true)
      } else if (file.name.endsWith(".txt") || file.type === "text/plain") {
        // Simple text parsing - assume each line is ticker percentage share_price shares
        const lines = content.trim().split(/\r?\n/)
        parsed = lines
          .map((line, index) => {
            const parts = line.trim().split(/[,\s]+/)
            const rawTicker = parts[0]?.trim() ?? ""
            if (!rawTicker) return null
            const tickerCandidates = buildTickerCandidateList(rawTicker)
            const holding: ParsedHolding = {
              rowNumber: index + 1,
              rawTicker,
              ticker: tickerCandidates.primary ?? rawTicker.toUpperCase(),
              candidates: tickerCandidates.candidates,
              identifiers: {},
            }
            if (parts[1]) {
              const weight = Number.parseFloat(parts[1].replace("%", ""))
              if (!Number.isNaN(weight)) {
                holding.weight = weight > 1 ? weight / 100 : weight
              }
            }
            if (parts[2]) {
              const price = Number.parseFloat(parts[2].replace("$", ""))
              if (!Number.isNaN(price)) {
                holding.purchasePrice = price
              }
            }
            if (parts[3]) {
              const shares = Number.parseFloat(parts[3])
              if (!Number.isNaN(shares)) {
                holding.shares = shares
              }
            }
            return holding
          })
          .filter((h): h is ParsedHolding => Boolean(h))
        if (parsed.length === 0) {
          throw new Error("No valid holdings found in the file.")
        }
        setParsedData(parsed)
        setShowPreview(true)
        setIsCSV(false)
        setIdentifierColumns({})
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
    setResolutionSummary(null)

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error("Not authenticated")

      const resolverResponse = await fetch("/api/tickers/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          holdings: parsedData.map((holding) => ({
            rowNumber: holding.rowNumber,
            rawTicker: holding.rawTicker,
            ticker: holding.ticker,
            candidates: holding.candidates,
            identifiers: holding.identifiers,
          })),
        }),
      })

      const resolverPayload = await resolverResponse
        .json()
        .catch(() => ({ error: "Failed to resolve tickers" }))

      if (!resolverResponse.ok || (resolverPayload as any)?.error) {
        const message =
          typeof (resolverPayload as any)?.error === "string"
            ? (resolverPayload as any).error
            : "Failed to resolve tickers"
        throw new Error(message)
      }

      const resolution = resolverPayload as TickerResolutionResponse
      const resolvedRecords = Array.isArray(resolution.resolved) ? resolution.resolved : []
      const unresolvedRecords = Array.isArray(resolution.unresolved) ? resolution.unresolved : []

      const resolutionByRow = new Map<number, TickerResolutionRecord>()
      resolvedRecords.forEach((record) => {
        resolutionByRow.set(record.rowNumber, record)
      })

      const normalizedHoldings = parsedData.map((holding) => {
        const resolved = resolutionByRow.get(holding.rowNumber)
        if (!resolved) {
          return { ...holding, resolution: undefined }
        }

        return {
          ...holding,
          ticker: resolved.resolvedTicker,
          resolution: {
            resolvedTicker: resolved.resolvedTicker,
            source: resolved.source,
            confidence: resolved.confidence,
            usedIdentifier: resolved.usedIdentifier,
            note: resolved.note,
          },
        }
      })

      setParsedData(normalizedHoldings)

      if (unresolvedRecords.length > 0) {
        const unresolvedSummary = unresolvedRecords
          .map((record) => record.rawTicker || `row ${record.rowNumber}`)
          .join(", ")
        setError(
          `Unable to resolve ticker(s): ${unresolvedSummary}. Adjust the column mapping or update your file and try again.`,
        )
        setIsLoading(false)
        return
      }

      const sourceLabels: Record<string, string> = {
        provided: "exact match",
        candidate: "cleaned value",
        isin: "via ISIN",
        search: "via search",
      }

      const sourceCounts = resolvedRecords.reduce<Record<string, number>>((acc, record) => {
        const key = record.source || "candidate"
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {})

      const summaryParts = Object.entries(sourceCounts).map(([source, count]) => {
        const label = sourceLabels[source] || source
        return `${count} ${label}`
      })

      if (summaryParts.length) {
        setResolutionSummary(`Resolved ${resolvedRecords.length} tickers (${summaryParts.join(", ")}).`)
      }

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
      const holdings = normalizedHoldings.map((holding) => ({
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
            {resolutionSummary && (
              <Alert className="mb-4 border-green-200 bg-green-50 text-green-800 dark:border-green-400/20 dark:bg-green-950/20 dark:text-green-200">
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>{resolutionSummary}</AlertDescription>
              </Alert>
            )}
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
                        <td className="p-2 font-mono">
                          {holding.ticker}
                          {holding.rawTicker &&
                            holding.rawTicker.toUpperCase() !== holding.ticker && (
                              <div className="text-xs text-slate-500 dark:text-slate-400">
                                Original: {holding.rawTicker}
                              </div>
                            )}
                        </td>
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
