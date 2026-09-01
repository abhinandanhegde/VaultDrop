"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  glow?: boolean;
  hover?: boolean;
  gradient?: boolean;
  premium?: boolean;
  as?: "div" | "section" | "article";
}

export default function GlassCard({
  children,
  className,
  glow = false,
  hover = false,
  gradient = false,
  premium = false,
  as: Tag = "div",
}: GlassCardProps) {
  if (hover) {
    return (
      <motion.div
        whileHover={{ y: -4, boxShadow: "0 20px 60px -12px hsl(var(--primary) / 0.12), 0 8px 24px -8px hsl(0 0% 0% / 0.12)" }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className={cn(
          "rounded-2xl p-6",
          premium ? "glass-premium" : "glass-strong",
          glow && "glow-border",
          gradient && "gradient-border",
          className,
        )}
      >
        {children}
      </motion.div>
    );
  }

  return (
    <Tag
      className={cn(
        "rounded-2xl p-6",
        premium ? "glass-premium" : "glass-strong",
        "transition-all duration-300 ease-out",
        glow && "glow-border",
        gradient && "gradient-border",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
