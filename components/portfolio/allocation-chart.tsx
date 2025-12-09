"use client"

import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts"

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
  const RAD = Math.PI / 180

  const renderLabel = (entry: any) => {
    const radius = entry.innerRadius + (entry.outerRadius - entry.innerRadius) * 1.2
    const x = entry.cx + radius * Math.cos(-entry.midAngle * RAD)
    const y = entry.cy + radius * Math.sin(-entry.midAngle * RAD)

    return (
      <text
        x={x}
        y={y}
        fill="currentColor"
        textAnchor={x > entry.cx ? "start" : "end"}
        dominantBaseline="central"
        className="text-xs"
      >
        {`${entry.sector ?? entry.name}: ${Number(entry.allocation ?? entry.value).toFixed(1)}%`}
      </text>
    )
  }

  return (
    <div className="h-full w-full flex flex-col text-slate-800 dark:text-slate-200">
      {/* Chart area takes the available vertical space, with a little top padding so labels don't clip */}
      <div className="flex-1 min-h-[200px] pt-2 px-2">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Pie
              data={visible}
              // Leave some room for the legend below by moving the pie slightly up
              cx="50%"
              cy="50%"
              innerRadius="45%"
              outerRadius="70%"
              dataKey="allocation"
              // Keep labels outside the donut to avoid clipping
              label={renderLabel}
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
