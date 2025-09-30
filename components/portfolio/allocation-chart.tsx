"use client"

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts"

interface AllocationData {
  sector: string
  allocation: number
  target: number
  color: string
}

interface AllocationChartProps {
  data: AllocationData[]
}

// A compact swatch for legend items
function Swatch({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-3 w-3 rounded-[3px]"
      style={{ backgroundColor: color }}
      aria-hidden
    />
  )
}

export function AllocationChart({ data }: AllocationChartProps) {
  // Filter out ~0% to avoid noisy legend items
  const visible = (data ?? []).filter((d) => (d.allocation ?? 0) > 0.05)

  return (
    <div className="h-full w-full flex flex-col">
      {/* Chart area takes the available vertical space, with a little top padding so labels don't clip */}
      <div className="flex-1 min-h-[160px] pt-2 px-2">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={visible}
              // Leave some room for the legend below by moving the pie slightly up
              cx="50%%"
              cy="45%"
              innerRadius="45%"
              outerRadius="80%"
              dataKey="allocation"
              // Keep labels tidy; they render inside the donut
              label={({ sector, allocation }) => `${sector}: ${Number(allocation).toFixed(1)}%`}
              labelLine={false}
              isAnimationActive
            >
              {visible.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Built-in, card-contained legend (outside the SVG so it never clips) */}
      <div className="mt-3 px-3 pb-2 grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-4 text-xs text-slate-600 dark:text-slate-400">
        {visible.map((item) => (
          <div key={item.sector} className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <Swatch color={item.color} />
              <span className="truncate" title={item.sector}>{item.sector}</span>
            </div>
            <div className="tabular-nums ml-3">
              {Number(item.allocation).toFixed(1)}%
            </div>
          </div>)
        )}
        {visible.length === 0 && (
          <div className="text-slate-500">No funded sectors yet.</div>
        )}
      </div>
    </div>
  )
}
