"use client";

import { cn } from "@/lib/utils";

interface GradientLineProps {
  className?: string;
  direction?: "horizontal" | "vertical";
}

export default function GradientLine({ className, direction = "horizontal" }: GradientLineProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden",
        direction === "horizontal" ? "h-px w-full" : "h-full w-px",
        className
      )}
      aria-hidden="true"
    >
      <div
        className={cn(
          "absolute inset-0 gradient-line-shimmer",
          direction === "horizontal"
            ? "bg-gradient-to-r from-transparent via-primary/40 to-transparent"
            : "bg-gradient-to-b from-transparent via-primary/40 to-transparent"
        )}
      />
    </div>
  );
}
