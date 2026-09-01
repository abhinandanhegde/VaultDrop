"use client";

import { Lock, Github, Shield } from "lucide-react";
import { motion } from "framer-motion";
import GradientLine from "@/components/gradient-line";

export default function Footer() {
  return (
    <footer className="relative border-t border-border/10 bg-background/30 backdrop-blur-sm">
      <GradientLine className="absolute top-0 left-0 right-0" />
      <div className="mx-auto flex h-20 w-full max-w-6xl flex-col items-center justify-between gap-4 px-4 sm:h-16 sm:flex-row sm:px-6 lg:px-8">
        <div className="flex items-center gap-2.5 text-xs text-muted-foreground/40">
          <motion.div
            whileHover={{ scale: 1.1, rotate: 5 }}
            className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 to-purple-500/20"
          >
            <Lock className="h-3 w-3 text-primary/60" aria-hidden="true" />
          </motion.div>
          <span className="font-semibold tracking-tight">VaultDrop</span>
          <span className="hidden text-muted-foreground/20 sm:inline">·</span>
          <span className="hidden items-center gap-1 sm:inline">
            <Shield className="h-3 w-3 text-primary/40" />
            End-to-end encrypted
          </span>
        </div>
        <div className="flex items-center gap-5 text-xs text-muted-foreground/40">
          <span className="hidden font-mono text-[10px] tracking-wider sm:inline">AES-256-GCM · PBKDF2-SHA256</span>
          <a
            href="https://github.com/abhinandanhegde/VaultDrop"
            className="flex items-center gap-1.5 transition-colors hover:text-muted-foreground/70"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Github className="h-3.5 w-3.5" />
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}
