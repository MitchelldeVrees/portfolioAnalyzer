"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import type { LucideIcon } from "lucide-react"
import {
  buildInitialColumnMappings,
  buildTickerCandidateList,
  type ColumnMappings,
  type HoldingIdentifiers,
} from "@/lib/upload-parsing"
import {
  parseCSVContent,
  validateHoldings,
  detectDelimiter,
  type ParsedHolding,
} from "@/lib/csv-parser"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { TickerAutocomplete } from "@/components/portfolio/ticker-autocomplete"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Circle,
  DownloadCloud,
  FileText,
  FileWarning,
  RefreshCcw,
  Sparkles,
  Upload,
} from "lucide-react"
import { withCsrfHeaders } from "@/lib/security/csrf-client"
import { createClient as createSupabaseClient } from "@/lib/supabase/client"

export type UploadStep = "upload" | "validate" | "review" | "import" | "complete"

export type UploadHolding = ParsedHolding & {
  rowNumber: number
  rawTicker: string
  candidates: string[]
  identifiers: HoldingIdentifiers
  resolution?: {
    resolvedTicker: string
    source?: string | null
    confidence?: number | null
    usedIdentifier?: string | null
    note?: string | null
  }
}

type TickerResolutionRecord = {
  rowNumber: number
  rawTicker: string
  resolvedTicker: string
  source: "provided" | "candidate" | "isin" | "search"
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

export type ReviewColumnKind = "ticker" | "number" | "percentage" | "currency" | "text" | "date"

export type ReviewColumn = {
  key: keyof ColumnMappings
  label: string
  kind: ReviewColumnKind
}

export type ReviewCardProps = {
  parsedData: UploadHolding[]
  parseResult: { errors: string[]; warnings: string[] } | null
  errorCount: number
  warningCount: number
  errorMessage?: string | null
  canImport: boolean
  isImporting: boolean
  onDownloadIssues: () => void
  onImport: () => void
  currentStep: UploadStep
  columns: ReviewColumn[]
  onChangeHolding: (rowIndex: number, column: ReviewColumn, value: string) => void
}

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

const STEP_SEQUENCE: Array<{ id: Exclude<UploadStep, "complete">; label: string; description: string; Icon: LucideIcon }> = [
  { id: "upload", label: "Upload", description: "Add your CSV file", Icon: Upload },
  { id: "validate", label: "Validate", description: "Detect headers & mapping", Icon: Upload },
  { id: "review", label: "Review", description: "Inspect holdings & warnings", Icon: FileText },
  { id: "import", label: "Import", description: "Create portfolio in Portify", Icon: Sparkles },
]

interface PortfolioUploadFormProps {
  portfolioName: string
  portfolioDescription: string
  onPortfolioNameChange?: (value: string) => void
  onPortfolioDescriptionChange?: (value: string) => void
  onStepChange?: (step: UploadStep) => void
  onReviewContentChange?: (review: ReviewCardProps | null) => void
}

function formatFileSize(bytes: number): string {
  if (!bytes) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, exponent)
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

function formatCurrency(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return "-"
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatNumber(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return "-"
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 })
}

function formatPercentage(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return "-"
  return `${(value * 100).toFixed(2)}%`
}

function extractRowNumberFromMessage(message: string): number | null {
  const match = message.match(/row\s+(\d+)/i)
  if (match) {
    const parsed = Number.parseInt(match[1], 10)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function downloadIssueReport(errors: string[], warnings: string[]) {
  const lines = [
    "Portfolio upload issue report",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "Errors:",
    ...(errors.length ? errors : ["None"]),
    "",
    "Warnings:",
    ...(warnings.length ? warnings : ["None"]),
    "",
    "Tip: Fix the rows listed above and re-upload, or adjust column mapping.",
  ]
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = "portify-portfolio-upload-issues.txt"
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function DefaultReviewCardContent({
  parsedData,
  parseResult,
  errorCount,
  warningCount,
  canImport,
  isImporting,
  errorMessage,
  onDownloadIssues,
  onImport,
  columns,
  onChangeHolding,
}: ReviewCardProps) {
  const totalHoldings = parsedData.length

  const errorRows = useMemo(() => {
    const set = new Set<number>()
    parseResult?.errors.forEach((message) => {
      const rowNumber = extractRowNumberFromMessage(message)
      if (rowNumber) set.add(rowNumber)
    })
    return set
  }, [parseResult])

  const warningRows = useMemo(() => {
    const set = new Set<number>()
    parseResult?.warnings.forEach((message) => {
      const rowNumber = extractRowNumberFromMessage(message)
      if (rowNumber) set.add(rowNumber)
    })
    return set
  }, [parseResult])

  const getRowStatus = useCallback(
    (rowNumber: number | undefined) => {
      if (!rowNumber) return "valid"
      if (errorRows.has(rowNumber)) return "error"
      if (warningRows.has(rowNumber)) return "warning"
      return "valid"
    },
    [errorRows, warningRows],
  )

  const renderEditableCell = useCallback(
    (holding: UploadHolding, column: ReviewColumn, rowIndex: number) => {
      const key = column.key as keyof UploadHolding
      const rawValue = holding[key]
      const handleChange = (value: string) => onChangeHolding(rowIndex, column, value)

      switch (column.kind) {
        case "ticker":
          return (
            <TickerAutocomplete
              value={(holding.ticker ?? "").toUpperCase()}
              onChange={handleChange}
              placeholder="Select ticker"
            />
          )
        case "percentage": {
          const display = typeof rawValue === "number" ? (rawValue * 100).toString() : rawValue ? String(rawValue) : ""
          return (
            <Input
              type="number"
              step="0.01"
              min="0"
              value={display}
              onChange={(event) => handleChange(event.target.value)}
            />
          )
        }
        case "currency": {
          const display = rawValue ?? ""
          return (
            <Input
              type="number"
              step="0.01"
              value={display !== null && display !== undefined ? String(rawValue) : ""}
              onChange={(event) => handleChange(event.target.value)}
            />
          )
        }
        case "number": {
          const display = rawValue !== null && rawValue !== undefined ? String(rawValue) : ""
          return (
            <Input
              type="number"
              step="0.001"
              value={display}
              onChange={(event) => handleChange(event.target.value)}
            />
          )
        }
        case "date": {
          const display = rawValue ? String(rawValue).slice(0, 10) : ""
          return <Input type="date" value={display} onChange={(event) => handleChange(event.target.value)} />
        }
        default: {
          const display = rawValue ?? ""
          return <Input value={display ? String(display) : ""} onChange={(event) => handleChange(event.target.value)} />
        }
      }
    },
    [onChangeHolding],
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Review summary</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {totalHoldings} holdings detected. Import cleans the valid rows and flags anything that needs attention.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200">
            Valid rows: {totalHoldings - warningCount}
          </Badge>
          {warningCount > 0 && (
            <Badge variant="outline" className="border-amber-300 text-amber-600 dark:border-amber-400 dark:text-amber-300">
              Warnings: {warningCount}
            </Badge>
          )}
          {errorCount > 0 && <Badge variant="destructive">Errors: {errorCount}</Badge>}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 pb-4 dark:border-slate-800">
        <div className="max-h-72 overflow-auto pb-4 pr-2">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">Row</th>
                {columns.map((column) => (
                  <th
                    key={column.key as string}
                    className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide"
                  >
                    {column.label}
                  </th>
                ))}
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody>
              {parsedData.slice(0, 20).map((holding, index) => {
                const status = getRowStatus(holding.rowNumber)
                return (
                  <tr
                    key={`${holding.ticker}-${holding.rowNumber ?? index + 1}`}
                    className="border-b border-slate-100 dark:border-slate-800/60"
                  >
                    <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{index + 1}</td>
                    {columns.map((column) => (
                      <td key={`${column.key as string}-${index}`} className="px-3 py-2 align-middle">
                        {renderEditableCell(holding, column, index)}
                      </td>
                    ))}
                    <td className="px-3 py-2">
                      <Badge
                        variant={
                          status === "error"
                            ? "destructive"
                            : status === "warning"
                            ? "outline"
                            : "secondary"
                        }
                        className={cn(
                          "text-xs",
                          status === "warning" &&
                            "border-amber-300 text-amber-600 dark:border-amber-400 dark:text-amber-300",
                          status === "valid" &&
                            "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-200",
                        )}
                      >
                        {status === "error" ? "Needs fix" : status === "warning" ? "Warning" : "Ready"}
                      </Badge>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {parsedData.length > 20 && (
          <div className="bg-slate-100 px-3 py-2 text-xs text-slate-500 dark:bg-slate-900/50 dark:text-slate-400">
            Showing first 20 of {parsedData.length} rows.
          </div>
        )}
      </div>

      {parseResult && (parseResult.errors.length > 0 || parseResult.warnings.length > 0) && (
        <div className="space-y-2">
          {parseResult.errors.map((message, index) => (
            <Alert key={`error-${index}`} variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ))}
          {parseResult.warnings.map((message, index) => (
            <Alert
              key={`warning-${index}`}
              variant="default"
              className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200"
            >
              <FileWarning className="h-4 w-4" />
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {errorMessage && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Heads up</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      {errorMessage && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Heads up</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 pt-4">
        <LoadingButton
          type="button"
          onClick={onImport}
          loading={isImporting}
          loadingText="Importing portfolio…"
          spinnerPlacement="start"
          disabled={!canImport}
        >
          Import valid rows
        </LoadingButton>
      </div>
    </div>
  )
}

export function PortfolioUploadForm({
  portfolioName,
  portfolioDescription,
  onPortfolioNameChange: _onPortfolioNameChange,
  onPortfolioDescriptionChange: _onPortfolioDescriptionChange,
  onStepChange,
  onReviewContentChange,
}: PortfolioUploadFormProps) {
  const router = useRouter()
  const supabase = useMemo(() => createSupabaseClient(), [])

  const fileInputRef = useRef<HTMLInputElement>(null)

  const [currentStep, setCurrentStep] = useState<UploadStep>("upload")
  const [file, setFile] = useState<File | null>(null)
  const [fileName, setFileName] = useState<string>("")
  const [fileSize, setFileSize] = useState<number>(0)
  const [isDragOver, setIsDragOver] = useState(false)
  const [isCSV, setIsCSV] = useState(false)
  const [fileContent, setFileContent] = useState<string>("")
  const [headers, setHeaders] = useState<string[]>([])
  const [mappings, setMappings] = useState<ColumnMappings>(() => ({
    ticker: "",
    weight: "",
    shares: "",
    purchasePrice: "",
  }))
  const [parseResult, setParseResult] = useState<{ errors: string[]; warnings: string[] } | null>(null)
  const [parsedData, setParsedData] = useState<UploadHolding[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [mappingOpen, setMappingOpen] = useState(false)
  const [resolutionSummary, setResolutionSummary] = useState<string | null>(null)
  const [createdPortfolio, setCreatedPortfolio] = useState<{ id: string; name: string } | null>(null)
  const [detectedDelimiter, setDetectedDelimiter] = useState<string | null>(null)
  const [encoding, setEncoding] = useState<string | null>(null)
  const [uploadTime, setUploadTime] = useState<Date | null>(null)

  const revalidateHoldings = useCallback((holdings: UploadHolding[]) => {
    if (!holdings.length) {
      setParseResult({ errors: ["No holdings found"], warnings: [] })
      return
    }

    const validation = validateHoldings(holdings)
    const errors: string[] = []
    const warnings: string[] = []

    holdings.forEach((holding, index) => {
      const rowLabel = holding.rowNumber ?? index + 1
      if (!holding.ticker || !holding.ticker.trim()) {
        errors.push(`Row ${rowLabel}: Ticker is required.`)
      }
      if (holding.weight !== undefined && holding.weight !== null && !Number.isFinite(holding.weight)) {
        errors.push(`Row ${rowLabel}: Weight must be a number.`)
      }
    })

    errors.push(...validation.errors)
    warnings.push(...validation.warnings)

    setParseResult({ errors, warnings })
  }, [])

  const columnMeta = useMemo(() => {
    const meta: Partial<Record<keyof ColumnMappings, { label: string; kind: ReviewColumnKind }>> = {
      ticker: { label: "Ticker", kind: "ticker" },
      weight: { label: "Weight (%)", kind: "percentage" },
      shares: { label: "Shares", kind: "number" },
      purchasePrice: { label: "Purchase price", kind: "currency" },
    }

    return meta
  }, [])

  const editableColumns = useMemo<ReviewColumn[]>(() => {
    const keys: Array<keyof ColumnMappings> = []
    const add = (key: keyof ColumnMappings | undefined) => {
      if (!key) return
      if (keys.includes(key)) return
      keys.push(key)
    }

    add("ticker")
    if (mappings.weight) add("weight")
    if (mappings.shares) add("shares")
    if (mappings.purchasePrice) add("purchasePrice");

    return keys.map((key) => {
      const metaEntry = columnMeta[key] ?? { label: String(key), kind: "text" as ReviewColumnKind }
      return { key, label: metaEntry.label, kind: metaEntry.kind }
    })
  }, [columnMeta, mappings])

  const handleHoldingFieldChange = useCallback(
    (rowIndex: number, column: ReviewColumn, rawValue: string) => {
      setParsedData((previous) => {
        const next = previous.map((holding, index) => {
          if (index !== rowIndex) return holding

          const updated: UploadHolding = { ...holding }
          const key = column.key as keyof UploadHolding

          switch (column.kind) {
            case "ticker": {
              const formatted = rawValue.toUpperCase().trim()
              const candidates = buildTickerCandidateList(formatted || holding.rawTicker || "")
              updated.ticker = formatted
              updated.rawTicker = formatted
              updated.candidates = candidates.candidates
              break
            }
            case "percentage": {
              const parsed = Number.parseFloat(rawValue)
              updated.weight = Number.isFinite(parsed) ? parsed / 100 : undefined
              break
            }
            case "currency":
           case "number": {
              const parsed = Number.parseFloat(rawValue)
              ;(updated as any)[key] = Number.isFinite(parsed) ? parsed : undefined
              break
            }
            case "date": {
                ;(updated as any)[key] = rawValue ? rawValue : undefined
                break
              }
            default: {
              ;(updated as any)[key] = rawValue
            }
          }

          return updated
        })

        revalidateHoldings(next)
        return next
      })
    },
    [revalidateHoldings],
  )

  useEffect(() => {
    onStepChange?.(currentStep)
  }, [currentStep, onStepChange])

  const updateStep = useCallback((step: UploadStep) => {
    setCurrentStep(step)
  }, [])

  const enrichHoldings = useCallback(
    (holdings: ParsedHolding[]): UploadHolding[] => {
      return holdings.map((holding, index) => {
        const rawTicker = holding.ticker ?? ""
        const candidates = buildTickerCandidateList(rawTicker)

        return {
          ...holding,
          rowNumber: index + 1,
          rawTicker: candidates.original ?? rawTicker,
          ticker: candidates.primary ?? holding.ticker ?? rawTicker.toUpperCase(),
          candidates: candidates.candidates,
          identifiers: {},
        }
      })
    },
    [],
  )

  const resetFlow = useCallback(() => {
    setFile(null)
    setFileName("")
    setFileSize(0)
    setFileContent("")
    setHeaders([])
    setMappings({
      ticker: "",
      weight: "",
      shares: "",
      purchasePrice: "",
    })
    setParseResult(null)
    setParsedData([])
    setErrorMessage(null)
    setIsCSV(false)
    setMappingOpen(false)
    setResolutionSummary(null)
    setCreatedPortfolio(null)
    setDetectedDelimiter(null)
    setEncoding(null)
    setUploadTime(null)
    updateStep("upload")
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }, [updateStep])

  const updateMapping = useCallback((field: keyof ColumnMappings, value: string) => {
    setMappings((previous) => ({
      ...previous,
      [field]: value,
    }))
    updateStep("validate")
  }, [updateStep])

  const handleOptionalChange = useCallback(
    (field: keyof ColumnMappings, value: string) => {
      updateMapping(field, value === "none" ? "" : value)
    },
    [updateMapping],
  )

  const mappingStatus = useMemo(
    () => [
      { field: "ticker", label: "Ticker", required: true, mapped: Boolean(mappings.ticker) },
      { field: "weight", label: "Weight (%)", required: false, mapped: Boolean(mappings.weight) },
      { field: "shares", label: "Shares", required: false, mapped: Boolean(mappings.shares) },
      { field: "purchasePrice", label: "Purchase price", required: false, mapped: Boolean(mappings.purchasePrice) },
    ],
    [mappings],
  )

  const isMappingSatisfied = mappingStatus.filter((item) => item.required).every((item) => item.mapped)

  const parseCSVIfPossible = useCallback(() => {
    if (!isCSV || !fileContent) return
    if (!mappings.ticker) {
      setParseResult(null)
      setParsedData([])
      updateStep("validate")
      return
    }

    setIsBusy(true)
    setErrorMessage(null)

    try {
      const result = parseCSVContent(fileContent, mappings)
      setDetectedDelimiter(result.detectedDelimiter ?? null)
      setEncoding(result.encoding ?? null)

      if (result.holdings.length === 0) {
        setParsedData([])
        setParseResult({
          errors: result.errors.length ? result.errors : ["No valid holdings found in the file."],
          warnings: result.warnings,
        })
        updateStep("validate")
        return
      }

      const enriched = enrichHoldings(result.holdings)
      setParsedData(enriched)

      const validation = validateHoldings(enriched)
      const combinedErrors = [...result.errors, ...validation.errors]
      const combinedWarnings = [...result.warnings, ...validation.warnings]

      setParseResult({
        errors: combinedErrors,
        warnings: combinedWarnings,
      })

      updateStep("review")
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to parse CSV file.")
      updateStep("validate")
    } finally {
      setIsBusy(false)
    }
  }, [enrichHoldings, fileContent, isCSV, mappings, updateStep])

  useEffect(() => {
    parseCSVIfPossible()
  }, [parseCSVIfPossible])

  const processTextFile = useCallback((content: string) => {
    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)

    if (lines.length === 0) {
      setErrorMessage("File appears to be empty.")
      setParseResult(null)
      setParsedData([])
      updateStep("upload")
      return
    }

    const holdings: UploadHolding[] = []
    const warnings: string[] = []

    lines.forEach((line, index) => {
      const parts = line.split(/[,\s]+/).map((part) => part.trim())
      const rawTicker = parts[0]
      if (!rawTicker) {
        warnings.push(`Row ${index + 1}: Missing ticker value.`)
        return
      }

      const candidates = buildTickerCandidateList(rawTicker)
      const holding: UploadHolding = {
        ticker: candidates.primary ?? rawTicker.toUpperCase(),
        rawTicker,
        candidates: candidates.candidates,
        identifiers: {},
        rowNumber: index + 1,
      }

      if (parts[1]) {
        const parsedWeight = Number.parseFloat(parts[1].replace("%", ""))
        if (!Number.isNaN(parsedWeight)) {
          holding.weight = parsedWeight > 1 ? parsedWeight / 100 : parsedWeight
        }
      }

      if (parts[2]) {
        const parsedPrice = Number.parseFloat(parts[2].replace(/[$,]/g, ""))
        if (!Number.isNaN(parsedPrice)) {
          holding.purchasePrice = parsedPrice
        }
      }

      if (parts[3]) {
        const parsedShares = Number.parseFloat(parts[3].replace(/[$,]/g, ""))
        if (!Number.isNaN(parsedShares)) {
          holding.shares = parsedShares
        }
      }

      holdings.push(holding)
    })

    if (!holdings.length) {
      setErrorMessage("No valid holdings were detected in the file.")
      setParseResult({ errors: ["No valid rows detected."], warnings })
      setParsedData([])
      updateStep("upload")
      return
    }

    const validation = validateHoldings(holdings)
    setParsedData(holdings)
    setParseResult({
      errors: validation.errors,
      warnings: [...warnings, ...validation.warnings],
    })
    updateStep("review")
  }, [updateStep])

  const initializeUpload = useCallback(
    async (selectedFile: File) => {
      if (!selectedFile) return

      if (selectedFile.size > MAX_FILE_SIZE) {
        setErrorMessage("File is too large. Maximum supported size is 10 MB.")
        return
      }

      const extension = selectedFile.name.split(".").pop()?.toLowerCase()
      const isCsvFile = extension === "csv" || selectedFile.type === "text/csv"
      const isTextFile = extension === "txt" || selectedFile.type === "text/plain"

      if (!isCsvFile && !isTextFile) {
        setErrorMessage("Unsupported file type. Please upload a .csv file.")
        return
      }

      setFile(selectedFile)
      setFileName(selectedFile.name)
      setFileSize(selectedFile.size)
      setUploadTime(new Date())
      setErrorMessage(null)
      setParseResult(null)
      setParsedData([])
      setResolutionSummary(null)
      setCreatedPortfolio(null)
      setDetectedDelimiter(null)
      setEncoding(null)
      updateStep("validate")

      try {
        const content = await selectedFile.text()

        if (isCsvFile) {
          setIsCSV(true)
          setFileContent(content)

          const delimiter = detectDelimiter(content)
          const rawHeaders = content
            .split(/\r?\n/)[0]
            ?.split(delimiter)
            ?.map((header) => header.trim().replace(/['"]/g, "")) ?? []

          const initialMappings = buildInitialColumnMappings(rawHeaders)
          setHeaders(rawHeaders)
          setMappings(initialMappings)
          setMappingOpen(!initialMappings.ticker)
        } else {
          setIsCSV(false)
          setHeaders([])
          setFileContent("")
          processTextFile(content)
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Failed to read file.")
        updateStep("upload")
      }
    },
    [processTextFile, updateStep],
  )

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      setIsDragOver(false)

      const droppedFile = event.dataTransfer.files?.[0]
      if (droppedFile) {
        initializeUpload(droppedFile)
      }
    },
    [initializeUpload],
  )

  const handleFileInput = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFile = event.target.files?.[0]
      if (selectedFile) {
        initializeUpload(selectedFile)
        event.target.value = ""
      }
    },
    [initializeUpload],
  )

  const totalHoldings = parsedData.length
  const errorCount = parseResult?.errors.length ?? 0
  const warningCount = parseResult?.warnings.length ?? 0

  const canImport =
    totalHoldings > 0 &&
    errorCount === 0 &&
    portfolioName.trim().length > 0 &&
    !isImporting

  const handleDownloadIssues = useCallback(() => {
    downloadIssueReport(parseResult?.errors ?? [], parseResult?.warnings ?? [])
  }, [parseResult])

  const handleViewPortfolio = useCallback(() => {
    if (createdPortfolio) {
      router.push(`/dashboard/portfolio/${createdPortfolio.id}`)
    }
  }, [createdPortfolio, router])

  const handleSubmit = useCallback(async () => {
    if (!canImport) {
      if (!portfolioName.trim()) {
        setErrorMessage("Please give your portfolio a name before importing.")
        return
      }
      if (!parsedData.length) {
        setErrorMessage("Upload and validate a CSV before importing.")
        return
      }
      if (errorCount > 0) {
        setErrorMessage("Resolve the blocking errors before importing.")
        return
      }
    }

    setIsImporting(true)
    updateStep("import")
    setErrorMessage(null)
    setResolutionSummary(null)

    let insertedPortfolioId: string | null = null

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        throw new Error("You need to be signed in to import a portfolio.")
      }

      const resolverResponse = await fetch("/api/tickers/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          holdings: parsedData.map((holding) => ({
            rowNumber: holding.rowNumber,
            rawTicker: holding.rawTicker ?? holding.ticker,
            ticker: holding.ticker,
            candidates: holding.candidates,
            identifiers: holding.identifiers,
          })),
        }),
      })

      const resolverPayload = (await resolverResponse.json().catch(() => ({
        error: "Failed to resolve tickers",
      }))) as TickerResolutionResponse & { error?: string }

      if (!resolverResponse.ok || resolverPayload?.error) {
        throw new Error(
          resolverPayload?.error ?? "Ticker resolution service returned an unexpected response.",
        )
      }

      const resolvedRecords = Array.isArray(resolverPayload.resolved) ? resolverPayload.resolved : []
      const unresolvedRecords = Array.isArray(resolverPayload.unresolved) ? resolverPayload.unresolved : []

      const resolutionByRow = new Map<number, TickerResolutionRecord>()
      resolvedRecords.forEach((record) => {
        resolutionByRow.set(record.rowNumber, record)
      })

      const resolvedHoldings = parsedData.map((holding) => {
        const resolution = resolutionByRow.get(holding.rowNumber)
        if (!resolution) return holding
        return {
          ...holding,
          ticker: resolution.resolvedTicker,
          resolution: {
            resolvedTicker: resolution.resolvedTicker,
            source: resolution.source,
            confidence: resolution.confidence,
            usedIdentifier: resolution.usedIdentifier,
            note: resolution.note,
          },
        }
      })

      setParsedData(resolvedHoldings)

      if (unresolvedRecords.length > 0) {
        const unresolvedSummary = unresolvedRecords
          .map((record) => record.rawTicker || `row ${record.rowNumber}`)
          .join(", ")
        setErrorMessage(
          `We couldn’t resolve the ticker(s): ${unresolvedSummary}. Adjust the mapping or CSV and try again.`,
        )
        updateStep("review")
        setIsImporting(false)
        return
      }

      const sourceLabels: Record<string, string> = {
        provided: "exact match",
        candidate: "cleaned value",
        isin: "ISIN lookup",
        search: "symbol search",
      }

      if (resolvedRecords.length) {
        const sourceCounts = resolvedRecords.reduce<Record<string, number>>((acc, record) => {
          const key = record.source || "candidate"
          acc[key] = (acc[key] || 0) + 1
          return acc
        }, {})

        const parts = Object.entries(sourceCounts).map(([source, count]) => {
          const readable = sourceLabels[source] ?? source
          return `${count} via ${readable}`
        })

        if (parts.length) {
          setResolutionSummary(`Resolved ${resolvedRecords.length} tickers (${parts.join(", ")}).`)
        }
      }

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
      if (!portfolio) throw new Error("Portfolio creation returned no data.")
      insertedPortfolioId = portfolio.id

      const clampNumber = (value: number | null, scale: number): number | null => {
        if (value === null) return null
        if (!Number.isFinite(value)) return null
        return Number.parseFloat(value.toFixed(scale))
      }

      const parseNumeric = (value: unknown): number | null => {
        if (typeof value === "number") {
          return Number.isFinite(value) ? value : null
        }
        if (typeof value === "string") {
          const trimmed = value.trim()
          if (!trimmed) return null
          const normalised = trimmed.replace(/[^0-9.\-]/g, "")
          const parsed = Number.parseFloat(normalised)
          return Number.isFinite(parsed) ? parsed : null
        }
        return null
      }

      const normalizeWeight = (value: unknown): number => {
        const numeric = parseNumeric(value)
        if (numeric === null || numeric < 0) return 0
        if (numeric > 1 && numeric <= 100) return numeric / 100
        if (numeric > 1) return 1
        return numeric
      }

      const normalizeDateValue = (value: unknown): string | null => {
        if (!value) return null
        if (value instanceof Date && !Number.isNaN(value.getTime())) {
          return value.toISOString().slice(0, 10)
        }
        if (typeof value === "string") {
          const trimmed = value.trim()
          if (!trimmed) return null

          const isoMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
          if (isoMatch) {
            const [, year, month, day] = isoMatch
            const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
            if (!Number.isNaN(date.getTime())) {
              return date.toISOString().slice(0, 10)
            }
          }

          const shortIsoMatch = trimmed.match(/^(\d{8})$/)
          if (shortIsoMatch) {
            const digits = shortIsoMatch[1]
            const year = Number(digits.slice(0, 4))
            const month = Number(digits.slice(4, 6))
            const day = Number(digits.slice(6, 8))
            const date = new Date(Date.UTC(year, month - 1, day))
            if (!Number.isNaN(date.getTime())) {
              return date.toISOString().slice(0, 10)
            }
          }

          const euroMatch = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/)
          if (euroMatch) {
            const [, day, month, yearDigits] = euroMatch
            const year = yearDigits.length === 2 ? Number(`20${yearDigits}`) : Number(yearDigits)
            const date = new Date(Date.UTC(year, Number(month) - 1, Number(day)))
            if (!Number.isNaN(date.getTime())) {
              return date.toISOString().slice(0, 10)
            }
          }

          const parsed = new Date(trimmed)
          if (!Number.isNaN(parsed.getTime())) {
            return parsed.toISOString().slice(0, 10)
          }
        }
        return null
      }

      const holdingsPayload = resolvedHoldings
        .map((holding) => {
          const tickerSource = holding.ticker ?? holding.rawTicker ?? ""
          const ticker = typeof tickerSource === "string" ? tickerSource.trim().toUpperCase() : ""
          if (!ticker) return null

          const weightValue = clampNumber(normalizeWeight(holding.weight ?? 0), 4) ?? 0
          const sharesValue = clampNumber(parseNumeric(holding.shares ?? null), 6)
          const purchasePriceValue = clampNumber(parseNumeric(holding.purchasePrice ?? null), 2)

          return {
            ticker,
            weight: weightValue,
            shares: sharesValue ?? undefined,
            purchasePrice: purchasePriceValue ?? undefined,
          }
        })
        .filter((holding): holding is NonNullable<typeof holding> => holding !== null)

      if (!holdingsPayload.length) {
        throw new Error("No valid holdings to import after sanitization.")
      }

      const response = await fetch(
        "/api/portfolios",
        withCsrfHeaders({
          method: "POST",
          headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: portfolioName.trim(),
              description: portfolioDescription.trim() || undefined,
              holdings: holdingsPayload,
            }),
          }),
      )

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to import portfolio.")
      }

      setCreatedPortfolio({ id: payload.portfolioId, name: portfolioName.trim() })
      updateStep("complete")
      insertedPortfolioId = null
    } catch (error) {
      if (insertedPortfolioId) {
        await supabase.from("portfolios").delete().eq("id", insertedPortfolioId)
      }
      setErrorMessage(error instanceof Error ? error.message : "Failed to import portfolio.")
      updateStep("review")
    } finally {
      setIsImporting(false)
    }
  }, [canImport, errorCount, parsedData, portfolioDescription, portfolioName, router, supabase, updateStep])

  const reviewCardData = useMemo<ReviewCardProps | null>(() => {
    if (currentStep === "upload" || parsedData.length === 0) return null
    return {
      parsedData,
      parseResult,
      errorCount,
      warningCount,
      errorMessage,
      canImport,
      isImporting,
      onDownloadIssues: handleDownloadIssues,
      onImport: handleSubmit,
      currentStep,
      columns: editableColumns,
      onChangeHolding: handleHoldingFieldChange,
    }
  }, [
    currentStep,
    parsedData,
    parseResult,
    errorCount,
    warningCount,
    errorMessage,
    canImport,
    isImporting,
    resetFlow,
    handleDownloadIssues,
    handleSubmit,
    editableColumns,
    handleHoldingFieldChange,
  ])

  useEffect(() => {
    if (onReviewContentChange) {
      onReviewContentChange(reviewCardData)
    }
  }, [onReviewContentChange, reviewCardData])

  const currentStepIndex = useMemo(() => {
    if (currentStep === "complete") return STEP_SEQUENCE.length - 1
    const index = STEP_SEQUENCE.findIndex((step) => step.id === currentStep)
    return index === -1 ? 0 : index
  }, [currentStep])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-4">
          {STEP_SEQUENCE.map((step, index) => {
            const isCompleted = currentStepIndex > index
            const isCurrent = currentStepIndex === index

            return (
              <div key={step.id} className="flex items-center gap-2">
                <div
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full border text-sm font-medium transition-colors",
                    isCompleted
                      ? "border-blue-500 bg-blue-500 text-white"
                      : isCurrent
                      ? "border-blue-500 text-blue-600 dark:text-blue-300"
                      : "border-slate-300 text-slate-400 dark:border-slate-700 dark:text-slate-500",
                  )}
                  aria-label={step.label}
                >
                  {isCompleted ? <CheckCircle2 className="h-5 w-5" /> : index + 1}
                </div>
                <div className="text-xs">
                  <div
                    className={cn(
                      "font-semibold",
                      isCurrent
                        ? "text-slate-900 dark:text-slate-100"
                        : "text-slate-500 dark:text-slate-400",
                    )}
                  >
                    {step.label}
                  </div>
                  <div className="text-slate-500 dark:text-slate-400">{step.description}</div>
                </div>
                {index < STEP_SEQUENCE.length - 1 && (
                  <div className="hidden sm:block h-px w-10 bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault()
          setIsDragOver(true)
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          "rounded-xl border-2 border-dashed p-6 transition-colors",
          isDragOver
            ? "border-blue-500 bg-blue-50/50 dark:border-blue-500/70 dark:bg-blue-500/10"
            : "border-slate-300 dark:border-slate-700",
        )}
      >
        <div className="flex flex-col items-center justify-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
            <Upload className="h-6 w-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              Drag & drop your CSV here, or
              <Button
                type="button"
                variant="link"
                className="px-1 text-blue-600 hover:text-blue-500 dark:text-blue-400"
                onClick={() => fileInputRef.current?.click()}
              >
                browse to upload
              </Button>
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Supports .csv or .txt files · Max size {formatFileSize(MAX_FILE_SIZE)} · We’ll validate structure
              instantly.
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="hidden"
            onChange={handleFileInput}
          />
        </div>
        {file && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-900/60">
            <div className="flex flex-wrap items-center justify-between gap-2 text-slate-600 dark:text-slate-300">
              <div className="space-y-1">
                <p className="font-medium text-slate-900 dark:text-slate-100">{fileName}</p>
                <div className="flex flex-wrap items-center gap-3">
                  <span>{formatFileSize(fileSize)}</span>
                  {uploadTime && <span>Uploaded {uploadTime.toLocaleString()}</span>}
                  {detectedDelimiter && <span>Delimiter: {detectedDelimiter}</span>}
                  {encoding && <span>Encoding: {encoding}</span>}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  resetFlow()
                }}
              >
                <RefreshCcw className="mr-2 h-4 w-4" />
                Choose different file
              </Button>
            </div>
          </div>
        )}
      </div>

      {headers.length > 0 && (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-900/40">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Column mapping</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                We detected the following fields. Adjust if your headers differ or use the manual mapper.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="flex items-center gap-1 text-xs"
              onClick={() => setMappingOpen((value) => !value)}
            >
              <ChevronDown
                className={cn("h-4 w-4 transition-transform", mappingOpen ? "rotate-180" : "rotate-0")}
              />
              {mappingOpen ? "Hide mapping" : "Adjust mapping"}
            </Button>
          </div>

          <div className="flex flex-wrap gap-3">
            {mappingStatus.map((status) => (
              <div
                key={status.field}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3 py-1 text-xs",
                  status.mapped
                    ? "border-green-200 bg-green-50 text-green-700 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-300"
                    : status.required
                    ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300"
                    : "border-slate-200 bg-white text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300",
                )}
              >
                {status.mapped ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
                {status.label}
                {!status.mapped && status.required && <span className="rounded bg-red-100 px-1 text-[10px] text-red-600">required</span>}
              </div>
            ))}
          </div>

          {(mappingOpen || !isMappingSatisfied) && (
            <div className="space-y-4 rounded-lg bg-white p-4 shadow-sm dark:bg-slate-950/40">
              <div className="grid gap-4 md:grid-cols-2">
                {mappingStatus.map((mapping) => (
                  <div key={mapping.field} className="space-y-2">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                      {mapping.label} {mapping.required && <span className="text-red-500">*</span>}
                    </label>
                    <Select
                      value={mappings[mapping.field as keyof ColumnMappings] || "none"}
                      onValueChange={(value) => {
                        if (mapping.required) {
                          updateMapping(mapping.field as keyof ColumnMappings, value === "none" ? "" : value)
                        } else {
                          handleOptionalChange(mapping.field as keyof ColumnMappings, value)
                        }
                      }}
                    >
                      <SelectTrigger className="text-sm">
                        <SelectValue placeholder={`Select ${mapping.label}`} />
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
                ))}
              </div>

            </div>
          )}
        </div>
      )}

      {currentStep === "validate" && isBusy && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
          Validating headers and sample rows… hang tight.
        </div>
      )}

      {reviewCardData && !onReviewContentChange && (
        <Card className="border-slate-200 dark:border-slate-800/70">
          <CardHeader>
            <CardTitle className="text-slate-900 dark:text-slate-100">Review results</CardTitle>
            <CardDescription className="text-sm text-slate-600 dark:text-slate-400">
              Inspect the parsed holdings, warnings, and any issues before importing your portfolio.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DefaultReviewCardContent {...reviewCardData} />
          </CardContent>
        </Card>
      )}
      {currentStep === "import" && isImporting && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
              <Sparkles className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              Importing portfolio…
            </CardTitle>
            <CardDescription className="text-slate-600 dark:text-slate-400">
              We’re creating the portfolio and recording all holdings. This should only take a few seconds.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {currentStep === "complete" && createdPortfolio && (
        <Card className="border-green-200 bg-green-50/50 dark:border-green-900/50 dark:bg-green-950/30">
          <CardHeader className="space-y-2">
            <CardTitle className="flex items-center gap-2 text-green-700 dark:text-green-200">
              <Sparkles className="h-5 w-5" />
              Portfolio imported successfully
            </CardTitle>
            <CardDescription className="text-sm text-green-700/80 dark:text-green-200/80">
              {createdPortfolio.name} is ready. {parsedData.length} holdings were saved. Our AI engine is already
              analysing the portfolio for insights—check the Research tab in a moment.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {resolutionSummary && (
              <Alert className="border-green-300 bg-green-100 text-green-800 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-200">
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>{resolutionSummary}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={handleViewPortfolio}>
                View portfolio
              </Button>
              <Button type="button" variant="outline" onClick={resetFlow}>
                Upload another file
              </Button>
              {(warningCount > 0 || errorCount > 0) && (
                <Button type="button" variant="ghost" className="text-blue-600 dark:text-blue-400" onClick={handleDownloadIssues}>
                  <DownloadCloud className="mr-2 h-4 w-4" />
                  Download skipped rows
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
