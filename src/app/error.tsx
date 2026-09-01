"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import GlassCard from "@/components/glass-card";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("VaultDrop error:", error);
  }, [error]);

  return (
    <main className="relative flex min-h-screen items-center justify-center px-4">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute left-1/2 top-1/2 h-[400px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500/[0.06] blur-[140px]" />
      </div>
      <div className="relative z-10 w-full max-w-md">
        <GlassCard className="border-red-500/30 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/10">
            <AlertTriangle className="h-7 w-7 text-red-400" />
          </div>
          <h1 className="text-lg font-bold text-foreground">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            An unexpected error occurred. Your data is safe — nothing was sent or destroyed.
          </p>
          {error.digest && (
            <p className="mt-2 font-mono text-xs text-muted-foreground/50">
              Error ID: {error.digest}
            </p>
          )}
          <Button onClick={reset} className="mt-5 w-full rounded-xl" variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" />
            Try again
          </Button>
          <Button onClick={() => (window.location.href = "/")} className="mt-2 w-full rounded-xl" variant="ghost" size="sm">
            Return home
          </Button>
        </GlassCard>
      </div>
    </main>
  );
}
