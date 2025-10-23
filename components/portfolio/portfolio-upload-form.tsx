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
import { Upload, AlertCircle, CheckCircle2, HelpCircle, FileText, Settings } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { ColumnMappings, BLOOMBERG_FIELD_MAPPINGS, autoMapHeaders, getMappingsByCategory } from "@/lib/bloomberg-mapping"
import { parseCSVContent, validateHoldings, ParsedHolding } from "@/lib/csv-parser"

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
  const [parseResult, setParseResult] = useState<{ errors: string[]; warnings: string[] } | null>(null)
  const [showAdvancedMapping, setShowAdvancedMapping] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<string>("all")

  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    if (fileContent && mappings.ticker && isCSV) {
      setIsLoading(true)
      try {
        const result = parseCSVContent(fileContent, mappings)
        const validation = validateHoldings(result.holdings)
        
        setParseResult({
          errors: [...result.errors, ...validation.errors],
          warnings: [...result.warnings, ...validation.warnings]
        })
        
        if (result.holdings.length > 0) {
          setParsedData(result.holdings)
          setError(null)
        } else {
          setParsedData(null)
          setError("No valid holdings found in the file.")
        }
      } catch (err) {
        setParsedData(null)
        setError(err instanceof Error ? err.message : "Failed to parse file")
        setParseResult({ errors: [err instanceof Error ? err.message : "Failed to parse file"], warnings: [] })
      } finally {
        setIsLoading(false)
      }
    } else if (parsedData && !mappings.ticker) {
      setParsedData(null)
      setParseResult(null)
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
      setParseResult(null)
      setShowAdvancedMapping(false)
    }
  }

  const handleLoadHeaders = async () => {
    if (!file) return

    setIsLoading(true)
    setError(null)

    try {
      const content = await file.text()
      setFileContent(content)

      if (file.name.endsWith(".csv") || file.type === "text/csv") {
        const lines = content.trim().split("\n")
        if (lines.length < 1) {
          throw new Error("Empty file.")
        }
        
        // Detect delimiter
        const delimiter = content.includes('\t') ? '\t' : 
                         content.includes(';') ? ';' : 
                         content.includes('|') ? '|' : ','
        
        const rawHeaders = lines[0].split(delimiter).map((h) => h.trim().replace(/['"]/g, ''))
        setHeaders(rawHeaders)
        setIsCSV(true)

        // Auto-map headers using Bloomberg field mappings
        const autoMappings = autoMapHeaders(rawHeaders)
        
        // Fallback to basic mappings if auto-mapping fails
        const lowerHeaders = rawHeaders.map((h) => h.toLowerCase())
        let ticker = autoMappings.ticker || ""
        let weight = autoMappings.weight || ""
        let purchasePrice = autoMappings.purchasePrice || ""
        let shares = autoMappings.shares || ""

        // Enhanced auto-detection
        if (!ticker) {
          const tickerIdx = lowerHeaders.findIndex(
            (h) => h.includes("ticker") || h.includes("symbol") || h.includes("stock")
          )
          if (tickerIdx !== -1) ticker = rawHeaders[tickerIdx]
        }

        if (!weight) {
          const weightIdx = lowerHeaders.findIndex(
            (h) => h.includes("weight") || h.includes("allocation") || h.includes("percent") || h.includes("percentage")
          )
          if (weightIdx !== -1) weight = rawHeaders[weightIdx]
        }

        if (!shares) {
          const sharesIdx = lowerHeaders.findIndex(
            (h) => h.includes("shares") || h.includes("quantity") || h.includes("units") || h.includes("amount") || h.includes("position")
          )
          if (sharesIdx !== -1) shares = rawHeaders[sharesIdx]
        }

        if (!purchasePrice) {
          const priceIdx = lowerHeaders.findIndex(
            (h) => h.includes("price") || h.includes("cost") || h.includes("purchase") || h.includes("share price")
          )
          if (priceIdx !== -1) purchasePrice = rawHeaders[priceIdx]
        }

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
          ...autoMappings
        })

        setShowPreview(true)
      } else if (file.name.endsWith(".txt") || file.type === "text/plain") {
        // Simple text parsing - assume each line is ticker percentage share_price shares
        const lines = content.trim().split("\n")
        const parsed = lines
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

      // Insert holdings with enhanced Bloomberg fields
      const holdings = parsedData.map((holding) => ({
        portfolio_id: portfolio.id,
        ticker: holding.ticker,
        weight: holding.weight || 0,
        shares: holding.shares || null,
        purchase_price: holding.purchasePrice || null,
        // Bloomberg-specific fields
        security_name: holding.securityName || null,
        isin: holding.isin || null,
        cusip: holding.cusip || null,
        sedol: holding.sedol || null,
        market_value: holding.marketValue || null,
        cost_value: holding.costValue || null,
        unrealized_pl: holding.unrealizedPl || null,
        realized_pl: holding.realizedPl || null,
        total_pl: holding.totalPl || null,
        sector: holding.sector || null,
        country: holding.country || null,
        asset_type: holding.assetType || null,
        coupon: holding.coupon || null,
        maturity_date: holding.maturityDate || null,
        yield_to_maturity: holding.yieldToMaturity || null,
        trade_date: holding.tradeDate || null,
        settlement_date: holding.settlementDate || null,
        market_price: holding.marketPrice || null,
        account_id: holding.accountId || null,
        portfolio_name: holding.portfolioName || null,
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

  const getFieldMappingByBloombergField = (bloombergField: string) => {
    return BLOOMBERG_FIELD_MAPPINGS.find(mapping => mapping.bloombergField === bloombergField)
  }

  const getMappingsByCategory = (category: string) => {
    if (category === "all") return BLOOMBERG_FIELD_MAPPINGS
    return BLOOMBERG_FIELD_MAPPINGS.filter(mapping => mapping.category === category)
  }

  const formatValue = (value: any, type: string): string => {
    if (value === null || value === undefined) return "-"
    
    switch (type) {
      case 'currency':
        return `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      case 'percentage':
        return `${(Number(value) * 100).toFixed(2)}%`
      case 'number':
        return Number(value).toLocaleString('en-US')
      case 'date':
        return value
      default:
        return String(value)
    }
  }

  return (
    <div className="space-y-6">
      {/* Help Section */}
      <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2 text-blue-900 dark:text-blue-100">
            <HelpCircle className="w-5 h-5" />
            <span>Bloomberg CSV Import Guide</span>
          </CardTitle>
          <CardDescription className="text-blue-700 dark:text-blue-300">
            Import your portfolio data from Bloomberg Terminal exports or other CSV files with flexible column mapping.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div>
              <h4 className="font-semibold mb-2">Supported Bloomberg Fields:</h4>
              <ul className="space-y-1 text-blue-600 dark:text-blue-400">
                <li>• Ticker symbols (TICKER)</li>
                <li>• Security names (SECURITY_NAME)</li>
                <li>• Portfolio weights (WEIGHT_PCT)</li>
                <li>• Market values (MKT_VAL)</li>
                <li>• Cost basis (COST_VALUE)</li>
                <li>• P&L data (UNREALIZED_PL, REALIZED_PL)</li>
                <li>• Sector classifications (INDUSTRY_SECTOR)</li>
                <li>• And many more...</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-2">File Requirements:</h4>
              <ul className="space-y-1 text-blue-600 dark:text-blue-400">
                <li>• CSV format (.csv files)</li>
                <li>• First row must contain headers</li>
                <li>• Ticker column is required</li>
                <li>• Other columns are optional</li>
                <li>• Supports various delimiters (comma, semicolon, tab)</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Upload Form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Upload className="w-5 h-5" />
            <span>Upload Portfolio File</span>
          </CardTitle>
          <CardDescription>
            Upload your portfolio data from Bloomberg Terminal exports, Excel exports, or other CSV files.
            Our system will automatically detect and map common Bloomberg field names.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="portfolioName">Portfolio Name *</Label>
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
            <Label htmlFor="file">Portfolio File *</Label>
            <Input id="file" type="file" accept=".csv,.txt" onChange={handleFileChange} className="cursor-pointer" />
            <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
              <p><strong>CSV format:</strong> Recommended for Bloomberg exports. Include headers in the first row.</p>
              <p><strong>TXT format:</strong> Simple format: ticker percentage share_price shares (space or comma separated)</p>
              <p><strong>Auto-detection:</strong> We'll automatically detect Bloomberg field names and map them appropriately.</p>
            </div>
          </div>

          {file && !showPreview && (
            <Button onClick={handleLoadHeaders} disabled={isLoading} className="w-full">
              {isLoading ? "Analyzing File..." : "Load and Analyze File"}
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

      {/* Field Mapping Interface */}
      {showPreview && isCSV && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Settings className="w-5 h-5" />
                <span>Field Mapping</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAdvancedMapping(!showAdvancedMapping)}
              >
                {showAdvancedMapping ? "Hide Advanced" : "Show Advanced"}
              </Button>
            </CardTitle>
            <CardDescription>
              Map your CSV columns to portfolio fields. Required fields are marked with *.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={selectedCategory} onValueChange={setSelectedCategory}>
              <TabsList className="grid w-full grid-cols-6">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="security">Security</TabsTrigger>
                <TabsTrigger value="holdings">Holdings</TabsTrigger>
                <TabsTrigger value="analytics">Analytics</TabsTrigger>
                <TabsTrigger value="type">Type</TabsTrigger>
                <TabsTrigger value="trade">Trade</TabsTrigger>
              </TabsList>
              
              <TabsContent value={selectedCategory} className="mt-4">
                <div className="grid gap-4">
                  {getMappingsByCategory(selectedCategory).map((mapping) => {
                    const fieldName = mapping.bloombergField.toLowerCase().replace(/_/g, '') as keyof ColumnMappings;
                    const currentValue = mappings[fieldName] || "";
                    
                    return (
                      <div key={mapping.bloombergField} className="flex items-center space-x-4 p-3 border rounded-lg">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2">
                            <Label className="font-medium">
                              {mapping.displayName}
                              {mapping.required && <span className="text-red-500 ml-1">*</span>}
                            </Label>
                            <Badge variant="secondary" className="text-xs">
                              {mapping.dataType}
                            </Badge>
                          </div>
                          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                            {mapping.description}
                          </p>
                          <div className="text-xs text-slate-500 mt-1">
                            <strong>Examples:</strong> {mapping.examples.join(", ")}
                          </div>
                        </div>
                        <div className="w-64">
                          <Select
                            value={currentValue || "none"}
                            onValueChange={(value) => {
                              if (mapping.required) {
                                updateMapping(fieldName, value === "none" ? "" : value);
                              } else {
                                handleOptionalChange(fieldName, value);
                              }
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder={`Select ${mapping.displayName}`} />
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
                        </div>
                      </div>
                    );
                  })}
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      {/* Data Preview */}
      {showPreview && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              <span>Data Preview {parsedData ? `(${parsedData.length} holdings)` : ""}</span>
            </CardTitle>
            <CardDescription>Review your portfolio data before creating</CardDescription>
          </CardHeader>
          <CardContent>
            {/* Validation Messages */}
            {parseResult && (parseResult.errors.length > 0 || parseResult.warnings.length > 0) && (
              <div className="space-y-2 mb-4">
                {parseResult.errors.map((error, index) => (
                  <Alert key={index} variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ))}
                {parseResult.warnings.map((warning, index) => (
                  <Alert key={index} variant="default">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{warning}</AlertDescription>
                  </Alert>
                ))}
              </div>
            )}

            <div className="max-h-96 overflow-y-auto border rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800 sticky top-0">
                  <tr>
                    <th className="text-left p-2 border-b">Ticker</th>
                    <th className="text-left p-2 border-b">Weight</th>
                    <th className="text-left p-2 border-b">Shares</th>
                    <th className="text-left p-2 border-b">Price</th>
                    {showAdvancedMapping && (
                      <>
                        <th className="text-left p-2 border-b">Market Value</th>
                        <th className="text-left p-2 border-b">Sector</th>
                        <th className="text-left p-2 border-b">Asset Type</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {parsedData && parsedData.length > 0 ? (
                    parsedData.slice(0, 20).map((holding, index) => (
                      <tr key={index} className="border-b">
                        <td className="p-2 font-mono">{holding.ticker}</td>
                        <td className="p-2">{formatValue(holding.weight, 'percentage')}</td>
                        <td className="p-2">{formatValue(holding.shares, 'number')}</td>
                        <td className="p-2">{formatValue(holding.purchasePrice || holding.marketPrice, 'currency')}</td>
                        {showAdvancedMapping && (
                          <>
                            <td className="p-2">{formatValue(holding.marketValue, 'currency')}</td>
                            <td className="p-2">{holding.sector || "-"}</td>
                            <td className="p-2">{holding.assetType || "-"}</td>
                          </>
                        )}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={showAdvancedMapping ? 7 : 4} className="p-2 text-center text-slate-500">
                        {isCSV ? "Select columns to preview data" : "No data available"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {parsedData && parsedData.length > 20 && (
                <div className="p-2 text-center text-sm text-slate-500 bg-slate-50 dark:bg-slate-800">
                  Showing first 20 of {parsedData.length} holdings
                </div>
              )}
            </div>

            <div className="flex justify-between mt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setShowPreview(false)
                  setParsedData(null)
                  setParseResult(null)
                }}
              >
                Change File
              </Button>
              <LoadingButton
                onClick={handleSubmit}
                loading={isLoading}
                loadingText="Creating portfolio..."
                spinnerPlacement="start"
                disabled={!parsedData || !portfolioName.trim() || (parseResult?.errors.length || 0) > 0}
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