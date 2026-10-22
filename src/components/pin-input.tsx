"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

interface PinInputProps {
  onSubmit: (pin: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  resetKey?: number | string;
  className?: string;
}

export default function PinInput({ onSubmit, disabled, autoFocus, resetKey, className }: PinInputProps) {
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  // Reset when the parent asks (e.g. after an error)
  useEffect(() => {
    setDigits(["", "", "", "", "", ""]);
    setActive(0);
    if (autoFocus) refs.current[0]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => {
    if (autoFocus && resetKey === undefined) refs.current[0]?.focus();
  }, [autoFocus, resetKey]);

  const submit = useCallback(
    (pin: string) => {
      if (pin.length === 6 && !disabled) onSubmit(pin);
    },
    [onSubmit, disabled],
  );

  function focusNext(i: number) {
    refs.current[i + 1]?.focus();
    setActive(i + 1);
  }

  function focusPrev(i: number) {
    refs.current[i - 1]?.focus();
    setActive(i - 1);
  }

  function handleChange(i: number, value: string) {
    if (value.length > 1) return;
    if (!/^\d*$/.test(value)) return;

    const next = [...digits];
    next[i] = value;
    setDigits(next);

    if (value) {
      if (i < 5) {
        focusNext(i);
      } else {
        refs.current[5]?.blur();
        submit(next.join(""));
      }
    } else if (i > 0) {
      focusPrev(i);
    }
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      const next = [...digits];
      next[i - 1] = "";
      setDigits(next);
      focusPrev(i);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").trim();
    if (/^\d{6}$/.test(pasted)) {
      const next = pasted.split("");
      setDigits(next);
      setActive(5);
      refs.current[5]?.blur();
      submit(pasted);
    }
  }

  return (
    <div className={cn("flex justify-center gap-2.5", className)}>
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          autoComplete="one-time-code"
          value={digit}
          disabled={disabled}
          aria-label={`Digit ${i + 1}`}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          className={cn(
            "h-12 w-10 rounded-xl border text-center text-xl font-bold transition-all duration-150",
            "bg-background outline-none",
            digit
              ? "border-primary/70 bg-primary/10 text-foreground"
              : "border-input text-transparent caret-primary",
            active === i && !digit
              ? "border-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.15)]"
              : "",
            disabled && "opacity-60 cursor-not-allowed",
          )}
        />
      ))}
    </div>
  );
}