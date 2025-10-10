"use client"

import { forwardRef } from "react"
import type { ReactNode } from "react"
import { Loader2 } from "lucide-react"

import { Button, type ButtonProps } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type SpinnerPlacement = "start" | "end"

type ButtonSize = NonNullable<ButtonProps["size"]>

const sizeToSpinner: Record<ButtonSize, string> = {
  default: "h-4 w-4",
  sm: "h-3.5 w-3.5",
  lg: "h-5 w-5",
  icon: "h-4 w-4",
}

export interface LoadingButtonProps extends ButtonProps {
  loading?: boolean
  loadingText?: ReactNode
  spinnerPlacement?: SpinnerPlacement
}

export const LoadingButton = forwardRef<HTMLButtonElement, LoadingButtonProps>(
  (
    {
      children,
      loading = false,
      loadingText,
      spinnerPlacement = "start",
      disabled,
      size = "default",
      className,
      ...props
    },
    ref,
  ) => {
    const spinnerClass = sizeToSpinner[size] ?? sizeToSpinner.default
    const showStart = loading && spinnerPlacement === "start"
    const showEnd = loading && spinnerPlacement === "end"
    const content = loading ? loadingText ?? children : children

    return (
      <Button
        ref={ref}
        size={size}
        className={cn(className, loading && "pointer-events-none")}
        disabled={disabled || loading}
        aria-busy={loading}
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