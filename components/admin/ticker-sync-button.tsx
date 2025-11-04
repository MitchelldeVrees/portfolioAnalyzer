"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { withCsrfHeaders } from "@/lib/security/csrf-client";

type Props = {
  className?: string;
};

export function TickerSyncButton({ className }: Props) {
  const [isLoading, setIsLoading] = useState(false);

  const handleSync = async () => {
    if (isLoading) return;
    setIsLoading(true);

    try {
      const response = await fetch(
        "/api/admin/yahoo-ticker-sync",
        withCsrfHeaders({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }),
      );

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message = payload?.error ?? "Failed to sync tickers";
        toast({
          title: "Ticker sync failed",
          description: message,
          variant: "destructive",
        });
        return;
      }

      const summary = payload?.summary;
      toast({
        title: "Ticker catalog updated",
        description: summary
          ? `Upserted ${summary.upserted} entries (${summary.payloadSize} prepared, ${summary.missingMarketCap} without market cap).`
          : "Ticker data was refreshed successfully.",
      });
    } catch (err) {
      console.error("Ticker sync error", err);
      toast({
        title: "Ticker sync failed",
        description: "Unexpected network error",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button onClick={handleSync} disabled={isLoading} variant="outline" className={cn("gap-2", className)}>
      <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
      {isLoading ? "Updating…" : "Refresh Yahoo Tickers"}
    </Button>
  );
}
