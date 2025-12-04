export default function ConnectPortfolioLoading() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center px-4">
      <div className="flex flex-col items-center space-y-4 text-center">
        <div className="h-12 w-12 rounded-full border-4 border-blue-500 border-t-transparent animate-spin" aria-hidden="true" />
        <div>
          <p className="text-base font-semibold text-slate-900 dark:text-slate-100">Loading connect experience</p>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Hang tight while we prepare your portfolio upload and broker connections.
          </p>
        </div>
      </div>
    </div>
  )
}
