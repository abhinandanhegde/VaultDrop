"use client";

import { Lock, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface EnvelopeProps {
  open?: boolean;
  size?: "sm" | "md" | "lg";
  label?: string;
  className?: string;
}

const SIZES = {
  sm: { wrap: "h-16 w-24", seal: "h-7 w-7", text: "text-[10px]", icon: "h-3 w-3" },
  md: { wrap: "h-24 w-36", seal: "h-10 w-10", text: "text-xs", icon: "h-4 w-4" },
  lg: { wrap: "h-32 w-48", seal: "h-14 w-14", text: "text-sm", icon: "h-6 w-6" },
};

export default function Envelope({ open, size = "md", label, className }: EnvelopeProps) {
  const s = SIZES[size];

  return (
    <div className={cn("relative select-none", s.wrap, className)} aria-hidden="true">
      {/* Back panel */}
      <div className="absolute inset-0 rounded-lg bg-muted" />

      {/* Flap */}
      <div
        className={cn(
          "absolute left-0 right-0 top-0 h-[58%] origin-top rounded-t-lg transition-transform duration-500 ease-in-out",
          "border-l border-r border-t border-border/60 bg-card",
          open ? "-rotate-x-180 opacity-60" : "",
        )}
        style={{
          transform: open ? "rotateX(180deg)" : "rotateX(0deg)",
          clipPath: "polygon(0 0, 100% 0, 50% 100%)",
        }}
      />

      {/* Front panel with slot */}
      <div className="absolute inset-0 flex flex-col items-center justify-end rounded-lg border border-border/60 bg-gradient-to-br from-card to-muted px-2 pb-3">
        <div
          className={cn(
            "mb-1.5 h-0 w-[70%] border-t-2 border-dashed border-border/70 transition-opacity duration-300",
            open && "opacity-30",
          )}
        />
        {label && (
          <span className={cn("font-medium text-muted-foreground truncate max-w-full", s.text)}>
            {label}
          </span>
        )}
      </div>

      {/* Wax seal */}
      <div
        className={cn(
          "absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full",
          "bg-gradient-to-br from-rose-500 to-rose-700 text-white shadow-lg ring-4 ring-background/60",
          "transition-all duration-500",
          s.seal,
          open ? "-translate-y-[160%] opacity-0" : "",
        )}
      >
        {open ? (
          <Check className={s.icon} />
        ) : (
          <Lock className={s.icon} />
        )}
      </div>
    </div>
  );
}