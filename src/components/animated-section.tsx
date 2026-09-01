"use client";

import { cn } from "@/lib/utils";

interface AnimatedSectionProps {
  children: React.ReactNode;
  className?: string;
  delay?: 1 | 2 | 3 | 4 | 5 | 6;
  animation?: "fade-in" | "pop-in" | "rise";
}

export default function AnimatedSection({
  children,
  className,
  delay,
  animation = "rise",
}: AnimatedSectionProps) {
  const animClass = {
    "fade-in": "animate-fade-in",
    "pop-in": "animate-pop-in",
    rise: "animate-rise",
  }[animation];

  return (
    <div
      className={cn(
        animClass,
        delay && `stagger-${delay}`,
        className,
      )}
    >
      {children}
    </div>
  );
}
