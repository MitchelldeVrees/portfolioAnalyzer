"use client"

import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Plus, Upload, Edit3, BarChart3 } from "lucide-react"
import Link from "next/link"
import { formatDistanceToNow } from "date-fns"

interface Portfolio {
  id: string
  name: string
  description: string | null
  created_at: string
  updated_at: string
}

interface PortfolioListProps {
  portfolios: Portfolio[]
}

export function PortfolioList({ portfolios }: PortfolioListProps) {
  return (
    <div className="space-y-6">
      {/* Action Cards */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="border-2 border-dashed border-slate-300 dark:border-slate-600 hover:border-blue-400 dark:hover:border-blue-500 transition-colors cursor-pointer">
          <Link href="/dashboard/upload">
            <CardHeader className="text-center py-8">
              <div className="mx-auto w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center mb-4">
                <Upload className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <CardTitle className="text-slate-900 dark:text-slate-100">Upload Portfolio</CardTitle>
              <CardDescription>Upload CSV, Excel, or text files with your portfolio data</CardDescription>
            </CardHeader>
          </Link>
        </Card>

        <Card className="border-2 border-dashed border-slate-300 dark:border-slate-600 hover:border-green-400 dark:hover:border-green-500 transition-colors cursor-pointer">
          <Link href="/dashboard/create">
            <CardHeader className="text-center py-8">
              <div className="mx-auto w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center mb-4">
                <Plus className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
              <CardTitle className="text-slate-900 dark:text-slate-100">Create Manually</CardTitle>
              <CardDescription>Manually enter tickers and weights to build your portfolio</CardDescription>
            </CardHeader>
          </Link>
        </Card>
      </div>

      {/* Existing Portfolios */}
      {portfolios.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">Your Portfolios</h2>
          <div className="grid gap-4">
            {portfolios.map((portfolio) => (
              <Card key={portfolio.id} className="hover:shadow-md transition-shadow">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-slate-900 dark:text-slate-100">{portfolio.name}</CardTitle>
                      {portfolio.description && (
                        <CardDescription className="mt-1">{portfolio.description}</CardDescription>
                      )}
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                        Created {formatDistanceToNow(new Date(portfolio.created_at), { addSuffix: true })}
                      </p>
                    </div>
                    <div className="flex space-x-2">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/dashboard/portfolio/${portfolio.id}/edit`}>
                          <Edit3 className="w-4 h-4" />
                        </Link>
                      </Button>
                      <Button size="sm" asChild>
                        <Link href={`/dashboard/portfolio/${portfolio.id}`}>
                          <BarChart3 className="w-4 h-4 mr-2" />
                          Analyze
                        </Link>
                      </Button>
                    </div>
                  </div>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
