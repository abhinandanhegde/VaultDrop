"use client";

import { useRef, useState, type ReactNode } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { cn } from "@/lib/utils";

interface MagneticButtonProps {
  children: ReactNode;
  className?: string;
  strength?: number;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
}

export default function MagneticButton({
  children,
  className,
  strength = 0.3,
  onClick,
  disabled,
  type = "button",
}: MagneticButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const [, setIsHovered] = useState(false);

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const springX = useSpring(x, { stiffness: 300, damping: 20 });
  const springY = useSpring(y, { stiffness: 300, damping: 20 });

  const glowOpacity = useTransform(
    [springX, springY],
    ([vx, vy]: number[]) => {
      const dist = Math.sqrt(vx * vx + vy * vy);
      return Math.min(dist / 20, 0.6);
    }
  );

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    x.set((e.clientX - centerX) * strength);
    y.set((e.clientY - centerY) * strength);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
    setIsHovered(false);
  };

  return (
    <motion.button
      ref={ref}
      type={type}
      onClick={onClick}
      disabled={disabled}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
      style={{ x: springX, y: springY }}
      className={cn(
        "relative overflow-hidden",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
      whileTap={{ scale: 0.97 }}
    >
      {/* Glow effect */}
      <motion.div
        className="absolute inset-0 rounded-[inherit] bg-gradient-to-r from-primary/20 via-purple-500/20 to-primary/20 blur-xl"
        style={{ opacity: glowOpacity }}
      />
      <span className="relative z-10">{children}</span>
    </motion.button>
  );
}
