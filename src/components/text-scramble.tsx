"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface TextScrambleProps {
  text: string;
  className?: string;
  speed?: number;
  delay?: number;
  trigger?: boolean;
}

const CHARS = "!@#$%^&*()_+-=[]{}|;':\",./<>?~`ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export default function TextScramble({
  text,
  className,
  speed = 30,
  delay = 0,
  trigger = true,
}: TextScrambleProps) {
  const [display, setDisplay] = useState("");
  const frameRef = useRef(0);
  const queueRef = useRef<{ from: string; to: string; start: number; end: number; char?: string }[]>([]);
  const frameRequestRef = useRef<number>(0);

  useEffect(() => {
    if (!trigger) return;

    const timeout = setTimeout(() => {
      const queue: typeof queueRef.current = [];
      const oldText = display || "";
      const longest = Math.max(oldText.length, text.length);

      for (let i = 0; i < longest; i++) {
        const from = oldText[i] || "";
        const to = text[i] || "";
        const start = Math.floor(Math.random() * 20);
        const end = start + Math.floor(Math.random() * 20);
        queue.push({ from, to, start, end });
      }

      queueRef.current = queue;
      frameRef.current = 0;

      const update = () => {
        let output = "";
        let complete = 0;

        for (let i = 0; i < queueRef.current.length; i++) {
          const { from, to, start, end, char } = queueRef.current[i];

          if (frameRef.current >= end) {
            complete++;
            output += to;
          } else if (frameRef.current >= start) {
            if (!char || Math.random() < 0.28) {
              queueRef.current[i].char = CHARS[Math.floor(Math.random() * CHARS.length)];
            }
            output += `<span class="text-primary/60">${char || queueRef.current[i].char}</span>`;
          } else {
            output += from;
          }
        }

        setDisplay(output);

        if (complete < queueRef.current.length) {
          frameRef.current++;
          frameRequestRef.current = requestAnimationFrame(update);
        }
      };

      frameRequestRef.current = requestAnimationFrame(update);
    }, delay);

    return () => {
      clearTimeout(timeout);
      cancelAnimationFrame(frameRequestRef.current);
    };
  }, [text, trigger, delay, speed]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <span
      className={cn(className)}
      dangerouslySetInnerHTML={{ __html: display || text }}
    />
  );
}
