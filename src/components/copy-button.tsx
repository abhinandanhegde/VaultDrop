"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { copyToClipboard } from "@/lib/utils";

interface CopyButtonProps {
  text: string;
  label?: string;
  iconOnly?: boolean;
  compact?: boolean;
  className?: string;
  onCopy?: () => void;
}

export function CopyButton({ text, label, iconOnly, compact, className, onCopy }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await copyToClipboard(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      onCopy?.();
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  if (iconOnly) {
    return (
      <button
        onClick={handleCopy}
        aria-label={label || "Copy"}
        className={cn(
          "p-1 rounded-md hover:bg-accent transition-colors",
          className,
        )}
      >
        {copied ? (
          <Check className="h-4 w-4 text-green-500" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
      </button>
    );
  }

  return (
    <button
      onClick={handleCopy}
      className={cn(
        "inline-flex items-center gap-2 rounded-md border border-input bg-background font-medium hover:bg-accent transition-colors",
        compact ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs",
        className,
      )}
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 text-green-500" />
          Copied!
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" />
          {label || "Copy"}
        </>
      )}
    </button>
  );
}
