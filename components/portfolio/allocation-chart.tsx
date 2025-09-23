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

export function AllocationChart({ data }: AllocationChartProps) {
  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            outerRadius={100}
            dataKey="allocation"
            label={({ sector, allocation }) => `${sector}: ${allocation}%`}
            labelLine={false}
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              color: "hsl(var(--card-foreground))",
            }}
            formatter={(value: number, name: string, props: any) => [
              `${value}%`,
              props.payload.sector,
            ]}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
