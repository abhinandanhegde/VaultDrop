"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, useSpring, useMotionValue } from "framer-motion";
import { cn } from "@/lib/utils";

interface NumberCounterProps {
  value: number;
  className?: string;
  duration?: number;
  suffix?: string;
}

export default function NumberCounter({
  value,
  className,
  duration = 2,
  suffix = "",
}: NumberCounterProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });
  const motionValue = useMotionValue(0);
  const springValue = useSpring(motionValue, {
    stiffness: 100,
    damping: 30,
    duration: duration * 1000,
  });
  const [display, setDisplay] = useState("0");

  useEffect(() => {
    if (isInView) {
      motionValue.set(value);
    }
  }, [isInView, motionValue, value]);

  useEffect(() => {
    const unsubscribe = springValue.on("change", (latest) => {
      setDisplay(Math.round(latest).toString());
    });
    return unsubscribe;
  }, [springValue]);

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {display}{suffix}
    </span>
  );
}
