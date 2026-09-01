"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { Moon, Sun, Menu, X, Github, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

export default function Header() {
  const { theme, setTheme } = useTheme();

  const cycleTheme = () => {
    if (theme === "light") setTheme("dark");
    else if (theme === "dark") setTheme("void");
    else setTheme("light");
  };

  const ThemeIcon = () => {
    if (!mounted) return <Sun className="h-4 w-4" />;
    if (theme === "void") return <Sparkles className="h-4 w-4 text-cyan-400" />;
    if (theme === "dark") return <Moon className="h-4 w-4" />;
    return <Sun className="h-4 w-4" />;
  };
  const [menuOpen, setMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && menuOpen) {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    },
    [menuOpen],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-all duration-500",
        scrolled
          ? "border-b border-border/15 bg-background/60 backdrop-blur-3xl shadow-xl shadow-primary/[0.02]"
          : "border-b border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="group flex items-center gap-2.5">
          <motion.div
            whileHover={{ scale: 1.08, rotate: 3 }}
            whileTap={{ scale: 0.95 }}
            className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-purple-500 shadow-lg shadow-primary/25"
          >
            {/* Animated glow ring */}
            <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-primary to-purple-500 opacity-0 blur-md transition-opacity duration-300 group-hover:opacity-50" />
            <span className="relative text-white text-sm font-bold" aria-hidden="true">V</span>
          </motion.div>
          <span className="text-lg font-bold tracking-tight">
            Vault<span className="gradient-text-static">Drop</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <nav aria-label="Main navigation" className="hidden md:flex items-center gap-1">
          <Link href="/" className="relative rounded-xl px-4 py-2 text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-accent/40 hover:text-foreground">
            Create
          </Link>
          <Link href="/how-it-works" className="relative rounded-xl px-4 py-2 text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-accent/40 hover:text-foreground">
            How it works
          </Link>
          <a href="https://github.com/abhinandanhegde/VaultDrop" className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-accent/40 hover:text-foreground" target="_blank" rel="noopener noreferrer">
            <Github className="h-4 w-4" />
            GitHub
          </a>
          <div className="ml-2 h-5 w-px bg-border/30" />
          <motion.button
            aria-label="Cycle theme: light, dark, void"
            onClick={cycleTheme}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            className={cn("relative flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-200", "text-muted-foreground hover:bg-accent/50 hover:text-foreground")}
          >
            <motion.div
              key={theme}
              initial={{ rotate: -90, opacity: 0, scale: 0.5 }}
              animate={{ rotate: 0, opacity: 1, scale: 1 }}
              exit={{ rotate: 90, opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.3 }}
              className="relative h-4 w-4"
            >
              <ThemeIcon />
            </motion.div>
          </motion.button>
        </nav>

        {/* Mobile nav */}
        <div className="md:hidden flex items-center gap-1">
          <motion.button
            aria-label="Cycle theme: light, dark, void"
            onClick={cycleTheme}
            whileTap={{ scale: 0.9 }}
            className="relative flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-all duration-200 hover:bg-accent/50 hover:text-foreground"
          >
            <motion.div
              key={`mobile-${theme}`}
              initial={{ rotate: -90, opacity: 0, scale: 0.5 }}
              animate={{ rotate: 0, opacity: 1, scale: 1 }}
              exit={{ rotate: 90, opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.3 }}
              className="relative h-4 w-4"
            >
              <ThemeIcon />
            </motion.div>
          </motion.button>
          <motion.button
            ref={menuButtonRef}
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen(!menuOpen)}
            whileTap={{ scale: 0.9 }}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-all duration-200 hover:bg-accent/50 hover:text-foreground"
          >
            <AnimatePresence mode="wait">
              {menuOpen ? (
                <motion.div key="close" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.2 }}>
                  <X className="h-4 w-4" />
                </motion.div>
              ) : (
                <motion.div key="menu" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} transition={{ duration: 0.2 }}>
                  <Menu className="h-4 w-4" />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.button>
        </div>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {menuOpen && (
          <motion.nav
            id="mobile-nav"
            aria-label="Mobile navigation"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="md:hidden overflow-hidden border-t border-border/15 bg-background/80 backdrop-blur-3xl"
          >
            <div className="mx-auto flex flex-col gap-1 px-4 py-3 max-w-6xl">
              <Link href="/" className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-colors hover:bg-accent/40" onClick={() => setMenuOpen(false)}>
                Create a drop
              </Link>
              <Link href="/how-it-works" className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-colors hover:bg-accent/40" onClick={() => setMenuOpen(false)}>
                How it works
              </Link>
              <a href="https://github.com/abhinandanhegde/VaultDrop" className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-colors hover:bg-accent/40" target="_blank" rel="noopener noreferrer" onClick={() => setMenuOpen(false)}>
                <Github className="h-4 w-4" />
                GitHub
              </a>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
