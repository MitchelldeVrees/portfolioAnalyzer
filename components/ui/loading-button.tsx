"use client"

import { forwardRef, type ComponentProps, type ReactNode } from "react"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const spinnerSizeByButton: Record<"default" | "sm" | "lg" | "icon", string> = {
  default: "h-4 w-4",
  sm: "h-3.5 w-3.5",
  lg: "h-5 w-5",
  icon: "h-4 w-4",
}

export interface LoadingButtonProps extends ComponentProps<typeof Button> {
  loading?: boolean
  loadingText?: ReactNode
  spinnerPlacement?: "start" | "end"
}

export const LoadingButton = forwardRef<HTMLButtonElement, LoadingButtonProps>(
  (
    {
      children,
      loading = false,
      loadingText,
      spinnerPlacement = "start",
      disabled,
      className,
      size = "default",
      ...props
    },
    ref,
  ) => {
    const sizeKey = (size ?? "default") as keyof typeof spinnerSizeByButton
    const spinnerClass = spinnerSizeByButton[sizeKey] ?? spinnerSizeByButton.default
    const showStart = loading && spinnerPlacement === "start"
    const showEnd = loading && spinnerPlacement === "end"
    const content = loading ? loadingText ?? children : children

    return (
      <Button
        ref={ref}
        size={size}
        className={cn(className, loading && "pointer-events-none")}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {showStart ? <Loader2 className={cn("mr-2 animate-spin", spinnerClass)} /> : null}
        {content}
        {showEnd ? <Loader2 className={cn("ml-2 animate-spin", spinnerClass)} /> : null}
      </Button>
    )
  },
)

LoadingButton.displayName = "LoadingButton"
