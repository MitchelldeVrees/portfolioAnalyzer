import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { PortfolioUploadForm } from "@/components/portfolio/portfolio-upload-form"

export default async function UploadPage() {
  const supabase = await createClient()

  const { data, error } = await supabase.auth.getUser()
  if (error || !data?.user) {
    redirect("/auth/login")
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <DashboardHeader user={data.user} />
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-2">Upload Portfolio</h1>
            <p className="text-slate-600 dark:text-slate-400">
              Import your portfolio data from Bloomberg Terminal exports, Excel files, or CSV files with advanced field mapping
            </p>
          </div>
          <PortfolioUploadForm />
        </div>
      </main>
    </div>
  )
}
