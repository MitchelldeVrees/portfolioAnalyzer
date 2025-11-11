import { redirect } from "next/navigation"
import type { User } from "@supabase/supabase-js"

import { ProfileSettings } from "@/components/account/profile-settings"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { createClient } from "@/lib/supabase/server"

type PortfolioRecord = {
  id: string
  name: string | null
}

export default async function AccountPage() {
  const supabase = await createClient()

  const { data, error } = await supabase.auth.getUser()
  if (error || !data?.user) {
    redirect("/auth/login")
  }

  const user = data.user as User

  const { data: portfolios } = await supabase
    .from("portfolios")
    .select("id, name")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })

  const serializedPortfolios: PortfolioRecord[] = (portfolios ?? []).map((portfolio) => ({
    id: portfolio.id,
    name: portfolio.name ?? "Untitled portfolio",
  }))

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <DashboardHeader user={user} />
      <main className="container mx-auto px-4 py-8">
        <div className="mx-auto max-w-4xl space-y-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Profile</h1>
            
          </div>
          <ProfileSettings user={user} portfolios={serializedPortfolios} />
        </div>
      </main>
    </div>
  )
}
