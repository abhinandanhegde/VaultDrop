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
  sm: { wrap: "h-16 w-24", seal: "h-7 w-7", text: "text-[10px]", icon: "h-3 w-3", slots: 4 },
  md: { wrap: "h-24 w-36", seal: "h-10 w-10", text: "text-xs", icon: "h-4 w-4", slots: 6 },
  lg: { wrap: "h-32 w-48", seal: "h-14 w-14", text: "text-sm", icon: "h-6 w-6", slots: 8 },
};

export default function Envelope({ open, size = "md", label, className }: EnvelopeProps) {
  const s = SIZES[size];

  return (
    <div className={cn("relative select-none", s.wrap, className)} aria-hidden="true">
      {/* Shadow */}
      <div className="absolute -bottom-2 left-1/2 h-3 w-[70%] -translate-x-1/2 rounded-full bg-black/20 blur-md" />

      {/* Back panel */}
      <div className="absolute inset-0 rounded-xl bg-gradient-to-b from-muted/60 to-muted/80 shadow-inner" />

      {/* Flap */}
      <div
        className={cn(
          "absolute left-0 right-0 top-0 h-[58%] origin-top rounded-t-xl transition-transform duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
          "border-l border-r border-t border-border/40 bg-gradient-to-b from-card/90 to-card/70",
        )}
        style={{
          transform: open ? "rotateX(180deg)" : "rotateX(0deg)",
          clipPath: "polygon(0 0, 100% 0, 50% 100%)",
        }}
      />

      {/* Front panel */}
      <div className="absolute inset-0 flex flex-col items-center justify-end rounded-xl border border-border/40 bg-gradient-to-br from-card via-card/95 to-muted/50 px-2 pb-3 shadow-md">
        {/* Slot lines */}
        <div className="mb-1.5 flex w-[65%] flex-col items-center gap-1">
          {Array.from({ length: s.slots }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-px w-full rounded-full transition-all duration-300",
                open ? "opacity-10 bg-foreground" : "opacity-20 bg-foreground",
              )}
            />
          ))}
        </div>
        {label && (
          <span className={cn("font-medium text-muted-foreground/80 truncate max-w-full", s.text)}>
            {label}
          </span>
        )}
      </div>

      {/* Wax seal */}
      <div
        className={cn(
          "absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full",
          "bg-gradient-to-br from-rose-500 via-rose-600 to-rose-700 text-white",
          "shadow-lg shadow-rose-500/30 ring-[3px] ring-background/70",
          "transition-all duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
          s.seal,
          open ? "-translate-y-[160%] opacity-0 scale-50" : "hover:scale-110 hover:shadow-xl hover:shadow-rose-500/40",
        )}
      >
        {open ? (
          <Check className={s.icon} strokeWidth={3} />
        ) : (
          <Lock className={s.icon} strokeWidth={2.5} />
        )}
      </div>

      {/* Particle burst on open */}
      {open && (
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          {Array.from({ length: 8 }).map((_, i) => {
            const angle = (i * 45) * (Math.PI / 180);
            const dist = 40 + i * 6;
            const tx = Math.cos(angle) * dist;
            const ty = Math.sin(angle) * dist;
            const colors = ["bg-rose-400", "bg-rose-500", "bg-primary", "bg-rose-300", "bg-amber-400", "bg-rose-600", "bg-primary/70", "bg-amber-300"];
            return (
              <span
                key={i}
                className={cn("absolute left-1/2 top-1/2 h-1 w-1 rounded-full", colors[i])}
                style={{
                  "--tx": `${tx}px`,
                  "--ty": `${ty}px`,
                  animation: `particle-burst 0.6s ${i * 40}ms cubic-bezier(0.16, 1, 0.3, 1) forwards`,
                } as React.CSSProperties}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
