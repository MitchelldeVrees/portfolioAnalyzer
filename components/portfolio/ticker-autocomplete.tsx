"use client"

import { useState, useEffect, useRef } from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

export interface TickerSearchResult {
  symbol: string
  name: string
  marketCap?: number
  sector?: string
  exchange?: string
}

interface TickerAutocompleteProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function TickerAutocomplete({
  value,
  onChange,
  placeholder = "Search tickers...",
  className,
  disabled = false,
}: TickerAutocompleteProps) {
  const [open, setOpen] = useState(false)
  const [searchResults, setSearchResults] = useState<TickerSearchResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const debounceTimeoutRef = useRef<NodeJS.Timeout>()

  // Debounced search function
  const searchTickers = async (query: string) => {
    if (!query || query.length < 1) {
      setSearchResults([])
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch(`/api/ticker-search?q=${encodeURIComponent(query)}`)
      if (response.ok) {
        const data = await response.json()
        setSearchResults(data.results || [])
      } else {
        setSearchResults([])
      }
    } catch (error) {
      console.error("Ticker search error:", error)
      setSearchResults([])
    } finally {
      setIsLoading(false)
    }
  }

  // Debounce search queries
  useEffect(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current)
    }

    debounceTimeoutRef.current = setTimeout(() => {
      searchTickers(searchQuery)
    }, 300) // 300ms debounce

    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
      }
    }
  }, [searchQuery])

  const handleSelect = (ticker: TickerSearchResult) => {
    onChange(ticker.symbol)
    setOpen(false)
    setSearchQuery("")
  }

  const formatMarketCap = (marketCap?: number) => {
    if (!marketCap) return ""
    
    if (marketCap >= 1e12) {
      return `$${(marketCap / 1e12).toFixed(1)}T`
    } else if (marketCap >= 1e9) {
      return `$${(marketCap / 1e9).toFixed(1)}B`
    } else if (marketCap >= 1e6) {
      return `$${(marketCap / 1e6).toFixed(1)}M`
    }
    return `$${marketCap.toLocaleString()}`
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between font-mono",
            !value && "text-muted-foreground",
            className
          )}
          disabled={disabled}
        >
          {value || placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" align="start">
        <div className="flex flex-col">
          <div className="flex items-center border-b px-3">
            <Input
              placeholder="Type to search tickers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="border-0 shadow-none focus-visible:ring-0"
            />
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {isLoading ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                Searching...
              </div>
            ) : searchResults.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                {searchQuery ? "No tickers found." : "Start typing to search..."}
              </div>
            ) : (
              <div className="p-1">
                {searchResults.map((ticker) => (
                  <div
                    key={ticker.symbol}
                    onClick={() => handleSelect(ticker)}
                    className="flex items-center justify-between cursor-pointer rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                  >
                    <div className="flex items-center">
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          value === ticker.symbol ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <div className="flex flex-col">
                        <span className="font-mono font-medium">{ticker.symbol}</span>
                        <span className="text-sm text-muted-foreground truncate max-w-[200px]">
                          {ticker.name}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end text-xs text-muted-foreground">
                      {ticker.marketCap && (
                        <span className="font-medium">{formatMarketCap(ticker.marketCap)}</span>
                      )}
                      {(ticker.exchange || ticker.sector) && (
                        <span className="truncate max-w-[120px]">
                          {ticker.exchange || ticker.sector}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
