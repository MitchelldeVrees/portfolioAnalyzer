"use client"

import { Loader2 } from "lucide-react"
import type { SVGAttributes } from "react"
import { cn } from "@/lib/utils"

type SpinnerSize = "sm" | "md" | "lg"

const sizeMap: Record<SpinnerSize, string> = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-8 w-8",
}

export interface SpinnerProps extends SVGAttributes<SVGSVGElement> {
  size?: SpinnerSize
}

export function Spinner({ size = "md", className, ...props }: SpinnerProps) {
  return (
    <Loader2
      aria-hidden="true"
      className={cn("animate-spin text-current", sizeMap[size], className)}
      {...props}
    />
  )
}