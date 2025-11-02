"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  PortfolioUploadForm,
  DefaultReviewCardContent,
  type UploadStep,
  type ReviewCardProps,
} from "@/components/portfolio/portfolio-upload-form"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Upload, Link as LinkIcon, Info, HelpCircle } from "lucide-react"
import { cn } from "@/lib/utils"

const SAMPLE_ROWS = [
  { ticker: "AAPL", weight: "0.12", shares: "150", price: "$165.40" },
  { ticker: "MSFT", weight: "0.10", shares: "120", price: "$290.10" },
  { ticker: "TSLA", weight: "0.08", shares: "75", price: "$205.55" },
  { ticker: "VTI", weight: "0.25", shares: "60", price: "$220.00" },
]

const REQUIRED_COLUMNS = [
  { label: "Ticker", hint: "Required" },
  { label: "Weight", hint: "Optional • % or decimal" },
  { label: "Shares", hint: "Optional" },
  { label: "PurchasePrice", hint: "Optional" },
]

export function ConnectPortfolioContent() {
  const [portfolioName, setPortfolioName] = useState("")
  const [portfolioDescription, setPortfolioDescription] = useState("")
  const [activeOption, setActiveOption] = useState<"none" | "csv" | "broker">("none")
  const [uploadStep, setUploadStep] = useState<UploadStep>("upload")
  const [reviewCardData, setReviewCardData] = useState<ReviewCardProps | null>(null)

  useEffect(() => {
    if (activeOption !== "csv") {
      setUploadStep("upload")
    }
    setReviewCardData(null)
  }, [activeOption])

  return (
    <div className="space-y-8">
      <div className="grid gap-4 md:grid-cols-2">
        <Card
          role="button"
          tabIndex={0}
          onClick={() => setActiveOption("csv")}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              setActiveOption("csv")
            }
          }}
          className={cn(
            "border-2 border-dashed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
            activeOption === "csv"
              ? "border-blue-500 bg-blue-50/40 dark:border-blue-500/70 dark:bg-blue-500/10"
              : "border-blue-200 hover:border-blue-400 dark:border-blue-900/50 dark:hover:border-blue-700",
          )}
        >
          <CardHeader className="space-y-3 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-900/30">
              <Upload className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            </div>
            <CardTitle className="text-slate-900 dark:text-slate-100">Upload CSV</CardTitle>
            <CardDescription className="text-sm">
              Import positions from Bloomberg, Excel, or any CSV export with guided validation.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card
          aria-disabled="true"
          className="border-2 border-dashed border-slate-200 bg-slate-100/70 text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400"
        >
          <CardHeader className="space-y-3 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-200 dark:bg-slate-800">
              <LinkIcon className="h-6 w-6" />
            </div>
            <CardTitle className="text-base">Connect your broker</CardTitle>
            <CardDescription className="text-xs text-slate-500 dark:text-slate-400">
              Coming soon — securely sync holdings straight from your custodian for always-on AI insights.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

      {activeOption === "none" && (
        <Card className="border-slate-200 bg-white text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
          <CardContent className="py-6 text-center">
            Select an option above to get started. Upload a CSV today or check back soon for direct broker connections.
          </CardContent>
        </Card>
      )}

      {activeOption === "csv" && (
        <div className="space-y-6">
          <Card className="border-slate-200 dark:border-slate-800/70">
            <CardHeader className="space-y-2">
              <CardTitle className="text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Info className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                CSV upload checklist
              </CardTitle>
              <CardDescription className="text-sm text-slate-600 dark:text-slate-400">
                Prepare your portfolio file before importing. These guidelines keep the validation step smooth.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 text-sm text-slate-600 dark:text-slate-300">
              <ul className="space-y-2">
                <li>• Format: UTF-8 encoded <strong>.csv</strong>, up to <strong>10 MB</strong> or <strong>10,000 rows</strong>.</li>
                <li>• First row must contain headers; additional metadata columns are welcome.</li>
                <li>• Required column: <strong>Ticker</strong>. Optional columns: Weight (%), Shares, PurchasePrice.</li>
                <li>• Percentages can be decimals (0.12) or percents (12%). We handle currency symbols.</li>
                <li>• Keep one holding per row. Duplicates will be flagged during validation.</li>
              </ul>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {REQUIRED_COLUMNS.map((column) => (
                    <Badge key={column.label} variant="outline" className="font-medium">
                      {column.label} <span className="ml-2 text-xs text-slate-500">{column.hint}</span>
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Other Bloomberg fields (ISIN, CUSIP, sector, market value, etc.) can be mapped later in the wizard.
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 uppercase text-xs tracking-wide">
                    <tr>
                      <th className="px-3 py-2 text-left">Ticker</th>
                      <th className="px-3 py-2 text-left">Weight</th>
                      <th className="px-3 py-2 text-left">Shares</th>
                      <th className="px-3 py-2 text-left">PurchasePrice</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SAMPLE_ROWS.map((row, index) => (
                      <tr key={row.ticker} className={index % 2 === 0 ? "bg-white dark:bg-slate-900/30" : "bg-slate-50 dark:bg-slate-900/10"}>
                        <td className="px-3 py-2 font-mono text-slate-900 dark:text-slate-100">{row.ticker}</td>
                        <td className="px-3 py-2">{row.weight}</td>
                        <td className="px-3 py-2">{row.shares}</td>
                        <td className="px-3 py-2">{row.price}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex items-center justify-between px-3 py-2 text-xs bg-slate-100/80 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400">
                  <Link
                    href="/samples/portfolio-template.csv"
                    target="_blank"
                    rel="noopener noreferrer"
                    download
                    className="text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Download template CSV
                  </Link>
                  <Link
                    href="https://docs.portify.app/csv-upload"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
                  >
                    <HelpCircle className="h-4 w-4" />
                    Need help?
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="border-slate-200 dark:border-slate-800/70">
              <CardHeader>
                <CardTitle className="text-slate-900 dark:text-slate-100">Portfolio details</CardTitle>
                <CardDescription className="text-sm text-slate-600 dark:text-slate-400">
                  Give your portfolio a name and optional context before importing positions.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="portfolioName" className="flex items-center gap-1 text-sm font-medium">
                    Portfolio name <span className="text-xs text-red-500">*</span>
                  </Label>
                  <Input
                    id="portfolioName"
                    placeholder="My Core Holdings"
                    value={portfolioName}
                    onChange={(event) => setPortfolioName(event.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="portfolioDescription" className="text-sm font-medium">
                    Description (optional)
                  </Label>
                  <Textarea
                    id="portfolioDescription"
                    placeholder="Describe the strategy, mandate, or benchmark for this portfolio."
                    value={portfolioDescription}
                    onChange={(event) => setPortfolioDescription(event.target.value)}
                    rows={3}
                  />
                </div>

                <p className="text-xs text-slate-500 dark:text-slate-400">
                  This information helps Portify label analytics and AI research for you. You can edit it anytime from the
                  portfolio settings page.
                </p>
              </CardContent>
            </Card>

            <Card id="upload-csv" className="border-slate-200 dark:border-slate-800/70">
              <CardHeader className="space-y-2">
                <CardTitle className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
                  <Upload className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  Upload CSV portfolio
                </CardTitle>
                <CardDescription className="text-sm text-slate-600 dark:text-slate-400">
                  Drag in your CSV or browse to select it. We&apos;ll validate headers, help you map columns, and show any
                  tickers that need attention before import.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <PortfolioUploadForm
                  portfolioName={portfolioName}
                  portfolioDescription={portfolioDescription}
                  onPortfolioNameChange={setPortfolioName}
                  onPortfolioDescriptionChange={setPortfolioDescription}
                  onReviewContentChange={setReviewCardData}
                  onStepChange={setUploadStep}
                />
              </CardContent>
            </Card>
          </div>

          {reviewCardData && (
            <Card className="border-slate-200 dark:border-slate-800/70">
              <CardHeader>
                <CardTitle className="text-slate-900 dark:text-slate-100">Review mapping</CardTitle>
                <CardDescription className="text-sm text-slate-600 dark:text-slate-400">
                  Column matching, validation warnings, and ticker resolution details appear below. Adjust mappings if
                  anything looks off before importing.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DefaultReviewCardContent {...reviewCardData} />
              </CardContent>
            </Card>
          )}

          {(uploadStep === "review" || uploadStep === "import" || uploadStep === "complete") && !reviewCardData && (
            <Card className="border-slate-200 dark:border-slate-800/70">
              <CardHeader>
                <CardTitle className="text-slate-900 dark:text-slate-100">Review mapping & warnings</CardTitle>
                <CardDescription className="text-sm text-slate-600 dark:text-slate-400">
                  The importer detected your columns and surfaced any rows that need attention. Double-check the mapping
                  panel above or adjust optional Bloomberg fields before finalising the import.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
                <p>
                  Use the “Adjust mapping” toggle in the upload card to refine column selection. Rows flagged with
                  warnings are still importable, while errors must be resolved before continuing.
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Tip: you can download an issue report from the Review step to fix problems offline and re-upload at any
                  time.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
