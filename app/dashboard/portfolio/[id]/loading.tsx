import { Skeleton } from "@/components/ui/skeleton"

export default function PortfolioDetailLoading() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <div className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/60">
        <div className="container mx-auto px-4">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-32" />
              <Skeleton className="h-6 w-24" />
            </div>
            <div className="flex items-center gap-3">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-10 w-24 rounded-full" />
            </div>
          </div>
        </div>
      </div>
      <main className="container mx-auto px-4 py-8">
        <div className="mx-auto max-w-6xl space-y-8">
          <div className="space-y-2">
            <Skeleton className="h-8 w-72" />
            <Skeleton className="h-4 w-64" />
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            <Skeleton className="col-span-2 h-64 rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/60" />
            <div className="space-y-4">
              {[...Array(3)].map((_, idx) => (
                <Skeleton
                  key={idx}
                  className="h-20 rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/60"
                />
              ))}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {[...Array(4)].map((_, idx) => (
              <Skeleton
                key={idx}
                className="h-40 rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/60"
              />
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
