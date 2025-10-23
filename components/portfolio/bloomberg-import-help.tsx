// Bloomberg Import Help Documentation Component
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { HelpCircle, FileText, Settings, CheckCircle2, AlertTriangle } from "lucide-react"

export function BloombergImportHelp() {
  return (
    <div className="space-y-6">
      {/* Overview */}
      <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2 text-blue-900 dark:text-blue-100">
            <HelpCircle className="w-5 h-5" />
            <span>Bloomberg Terminal Import Guide</span>
          </CardTitle>
          <CardDescription className="text-blue-700 dark:text-blue-300">
            Complete guide for importing portfolio data from Bloomberg Terminal exports
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-semibold mb-3 text-blue-900 dark:text-blue-100">Export Process</h4>
              <ol className="space-y-2 text-sm text-blue-600 dark:text-blue-400">
                <li>1. Open Bloomberg Terminal</li>
                <li>2. Navigate to Portfolio & Risk (PORT)</li>
                <li>3. Select your portfolio</li>
                <li>4. Choose "Export" → "CSV"</li>
                <li>5. Select desired fields (see field guide below)</li>
                <li>6. Download and upload to this system</li>
              </ol>
            </div>
            <div>
              <h4 className="font-semibold mb-3 text-blue-900 dark:text-blue-100">File Requirements</h4>
              <ul className="space-y-2 text-sm text-blue-600 dark:text-blue-400">
                <li>• CSV format (.csv files)</li>
                <li>• First row must contain headers</li>
                <li>• Ticker column is required</li>
                <li>• Other columns are optional</li>
                <li>• Supports various delimiters</li>
                <li>• UTF-8 encoding recommended</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Field Categories */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Core Fields */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <FileText className="w-5 h-5" />
              <span>Core Fields</span>
            </CardTitle>
            <CardDescription>Essential fields for portfolio analysis</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between p-2 border rounded">
              <div>
                <div className="font-medium">TICKER</div>
                <div className="text-sm text-slate-600">Stock symbol</div>
              </div>
              <Badge variant="destructive">Required</Badge>
            </div>
            <div className="flex items-center justify-between p-2 border rounded">
              <div>
                <div className="font-medium">WEIGHT_PCT</div>
                <div className="text-sm text-slate-600">Portfolio weight</div>
              </div>
              <Badge variant="secondary">Optional</Badge>
            </div>
            <div className="flex items-center justify-between p-2 border rounded">
              <div>
                <div className="font-medium">POSITION</div>
                <div className="text-sm text-slate-600">Number of shares</div>
              </div>
              <Badge variant="secondary">Optional</Badge>
            </div>
            <div className="flex items-center justify-between p-2 border rounded">
              <div>
                <div className="font-medium">PX_LAST</div>
                <div className="text-sm text-slate-600">Current price</div>
              </div>
              <Badge variant="secondary">Optional</Badge>
            </div>
          </CardContent>
        </Card>

        {/* Advanced Fields */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Settings className="w-5 h-5" />
              <span>Advanced Fields</span>
            </CardTitle>
            <CardDescription>Additional Bloomberg data for enhanced analysis</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between p-2 border rounded">
              <div>
                <div className="font-medium">MKT_VAL</div>
                <div className="text-sm text-slate-600">Market value</div>
              </div>
              <Badge variant="secondary">Optional</Badge>
            </div>
            <div className="flex items-center justify-between p-2 border rounded">
              <div>
                <div className="font-medium">COST_VALUE</div>
                <div className="text-sm text-slate-600">Cost basis</div>
              </div>
              <Badge variant="secondary">Optional</Badge>
            </div>
            <div className="flex items-center justify-between p-2 border rounded">
              <div>
                <div className="font-medium">INDUSTRY_SECTOR</div>
                <div className="text-sm text-slate-600">Sector classification</div>
              </div>
              <Badge variant="secondary">Optional</Badge>
            </div>
            <div className="flex items-center justify-between p-2 border rounded">
              <div>
                <div className="font-medium">UNREALIZED_PL</div>
                <div className="text-sm text-slate-600">Unrealized P&L</div>
              </div>
              <Badge variant="secondary">Optional</Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Complete Field Reference */}
      <Card>
        <CardHeader>
          <CardTitle>Complete Bloomberg Field Reference</CardTitle>
          <CardDescription>All supported Bloomberg fields organized by category</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* Portfolio Information */}
            <div>
              <h4 className="font-semibold mb-3 flex items-center">
                <Badge variant="outline" className="mr-2">Portfolio</Badge>
                Portfolio Information
              </h4>
              <div className="grid md:grid-cols-2 gap-2 text-sm">
                <div className="flex justify-between">
                  <span>PORTFOLIO_NAME</span>
                  <span className="text-slate-500">Portfolio Name</span>
                </div>
                <div className="flex justify-between">
                  <span>ACCT_ID</span>
                  <span className="text-slate-500">Account Number</span>
                </div>
              </div>
            </div>

            <Separator />

            {/* Security Identifiers */}
            <div>
              <h4 className="font-semibold mb-3 flex items-center">
                <Badge variant="outline" className="mr-2">Security</Badge>
                Security Identifiers
              </h4>
              <div className="grid md:grid-cols-2 gap-2 text-sm">
                <div className="flex justify-between">
                  <span>TICKER</span>
                  <span className="text-slate-500">Ticker Symbol</span>
                </div>
                <div className="flex justify-between">
                  <span>SECURITY_NAME</span>
                  <span className="text-slate-500">Security Description</span>
                </div>
                <div className="flex justify-between">
                  <span>ISIN</span>
                  <span className="text-slate-500">ISIN Code</span>
                </div>
                <div className="flex justify-between">
                  <span>CUSIP</span>
                  <span className="text-slate-500">CUSIP Code</span>
                </div>
                <div className="flex justify-between">
                  <span>SEDOL1</span>
                  <span className="text-slate-500">SEDOL Code</span>
                </div>
              </div>
            </div>

            <Separator />

            {/* Holdings Data */}
            <div>
              <h4 className="font-semibold mb-3 flex items-center">
                <Badge variant="outline" className="mr-2">Holdings</Badge>
                Holdings Data
              </h4>
              <div className="grid md:grid-cols-2 gap-2 text-sm">
                <div className="flex justify-between">
                  <span>POSITION</span>
                  <span className="text-slate-500">Quantity</span>
                </div>
                <div className="flex justify-between">
                  <span>MKT_VAL</span>
                  <span className="text-slate-500">Market Value</span>
                </div>
                <div className="flex justify-between">
                  <span>COST_PRICE</span>
                  <span className="text-slate-500">Cost Price</span>
                </div>
                <div className="flex justify-between">
                  <span>COST_VALUE</span>
                  <span className="text-slate-500">Cost Value</span>
                </div>
                <div className="flex justify-between">
                  <span>UNREALIZED_PL</span>
                  <span className="text-slate-500">Unrealized P/L</span>
                </div>
                <div className="flex justify-between">
                  <span>REALIZED_PL</span>
                  <span className="text-slate-500">Realized P/L</span>
                </div>
                <div className="flex justify-between">
                  <span>TOTAL_PL</span>
                  <span className="text-slate-500">Total P/L</span>
                </div>
              </div>
            </div>

            <Separator />

            {/* Analytics */}
            <div>
              <h4 className="font-semibold mb-3 flex items-center">
                <Badge variant="outline" className="mr-2">Analytics</Badge>
                Portfolio Analytics
              </h4>
              <div className="grid md:grid-cols-2 gap-2 text-sm">
                <div className="flex justify-between">
                  <span>WEIGHT_PCT</span>
                  <span className="text-slate-500">Weight (%)</span>
                </div>
                <div className="flex justify-between">
                  <span>INDUSTRY_SECTOR</span>
                  <span className="text-slate-500">Sector</span>
                </div>
                <div className="flex justify-between">
                  <span>CNTRY_OF_DOMICILE</span>
                  <span className="text-slate-500">Country</span>
                </div>
                <div className="flex justify-between">
                  <span>SECURITY_TYP</span>
                  <span className="text-slate-500">Asset Type</span>
                </div>
              </div>
            </div>

            <Separator />

            {/* Fixed Income */}
            <div>
              <h4 className="font-semibold mb-3 flex items-center">
                <Badge variant="outline" className="mr-2">Fixed Income</Badge>
                Fixed Income Securities
              </h4>
              <div className="grid md:grid-cols-2 gap-2 text-sm">
                <div className="flex justify-between">
                  <span>CPN</span>
                  <span className="text-slate-500">Coupon</span>
                </div>
                <div className="flex justify-between">
                  <span>MATURITY</span>
                  <span className="text-slate-500">Maturity Date</span>
                </div>
                <div className="flex justify-between">
                  <span>YIELD_TO_MATURITY</span>
                  <span className="text-slate-500">Yield (%)</span>
                </div>
              </div>
            </div>

            <Separator />

            {/* Trade Information */}
            <div>
              <h4 className="font-semibold mb-3 flex items-center">
                <Badge variant="outline" className="mr-2">Trade</Badge>
                Trade Information
              </h4>
              <div className="grid md:grid-cols-2 gap-2 text-sm">
                <div className="flex justify-between">
                  <span>TRADE_DATE</span>
                  <span className="text-slate-500">Trade Date</span>
                </div>
                <div className="flex justify-between">
                  <span>SETTLE_DT</span>
                  <span className="text-slate-500">Settlement Date</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tips and Best Practices */}
      <Card className="border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2 text-green-900 dark:text-green-100">
            <CheckCircle2 className="w-5 h-5" />
            <span>Tips & Best Practices</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-semibold mb-3 text-green-900 dark:text-green-100">Export Tips</h4>
              <ul className="space-y-2 text-sm text-green-600 dark:text-green-400">
                <li>• Include TICKER as the first column for easier mapping</li>
                <li>• Export WEIGHT_PCT for accurate portfolio analysis</li>
                <li>• Include MKT_VAL for current market values</li>
                <li>• Add INDUSTRY_SECTOR for sector analysis</li>
                <li>• Include COST_VALUE for performance tracking</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-3 text-green-900 dark:text-green-100">Common Issues</h4>
              <ul className="space-y-2 text-sm text-green-600 dark:text-green-400">
                <li>• Ensure headers are in the first row</li>
                <li>• Check for special characters in ticker symbols</li>
                <li>• Verify numeric fields contain only numbers</li>
                <li>• Remove any empty rows at the end</li>
                <li>• Use consistent date formats</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Troubleshooting */}
      <Card className="border-orange-200 bg-orange-50/50 dark:border-orange-800 dark:bg-orange-950/20">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2 text-orange-900 dark:text-orange-100">
            <AlertTriangle className="w-5 h-5" />
            <span>Troubleshooting</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 text-sm text-orange-600 dark:text-orange-400">
            <div>
              <h4 className="font-semibold mb-2">File Won't Load</h4>
              <ul className="space-y-1 ml-4">
                <li>• Check file format is CSV (.csv extension)</li>
                <li>• Ensure first row contains headers</li>
                <li>• Verify file is not corrupted</li>
                <li>• Try re-exporting from Bloomberg</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-2">Columns Not Mapping</h4>
              <ul className="space-y-1 ml-4">
                <li>• Use exact Bloomberg field names as headers</li>
                <li>• Check for extra spaces or special characters</li>
                <li>• Verify column names match our field list</li>
                <li>• Try manual mapping in advanced mode</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-2">Data Validation Errors</h4>
              <ul className="space-y-1 ml-4">
                <li>• Ensure ticker symbols are valid</li>
                <li>• Check numeric fields contain only numbers</li>
                <li>• Verify percentage values are reasonable</li>
                <li>• Remove any empty or invalid rows</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}


