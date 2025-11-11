import type { SupabaseClient } from "@supabase/supabase-js"

type AnyDatabase = any

export async function deleteAllUserPortfolioData(
  client: SupabaseClient<AnyDatabase, "public", AnyDatabase>,
  userId: string,
) {
  const { data: portfolios, error: portfoliosError } = await client
    .from("portfolios")
    .select("id")
    .eq("user_id", userId)

  if (portfoliosError) {
    throw portfoliosError
  }

  const ids = (portfolios ?? []).map((p) => p.id).filter(Boolean)
  if (!ids.length) {
    return { portfoliosDeleted: 0 }
  }

  const { error: snapshotDeleteError } = await client.from("portfolio_holdings_snapshots").delete().in("portfolio_id", ids)
  if (snapshotDeleteError) {
    throw snapshotDeleteError
  }

  const { error: holdingsDeleteError } = await client.from("portfolio_holdings").delete().in("portfolio_id", ids)
  if (holdingsDeleteError) {
    throw holdingsDeleteError
  }

  const { error: portfolioDeleteError } = await client.from("portfolios").delete().eq("user_id", userId)
  if (portfolioDeleteError) {
    throw portfolioDeleteError
  }

  return { portfoliosDeleted: ids.length }
}
