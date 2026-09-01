"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { Moon, Sun, Menu, X, Github } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect, useCallback, useRef } from "react";

export default function Header() {
  const { theme, setTheme } = useTheme();
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
        "sticky top-0 z-50 transition-all duration-300",
        scrolled
          ? "border-b border-border/20 bg-background/70 backdrop-blur-2xl shadow-lg shadow-primary/[0.03]"
          : "border-b border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="group flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-purple-500 shadow-lg shadow-primary/20 transition-transform duration-200 group-hover:scale-105">
            <span className="text-white text-sm font-bold" aria-hidden="true">V</span>
          </div>
          <span className="text-lg font-bold tracking-tight">
            Vault<span className="gradient-text-static">Drop</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <nav aria-label="Main navigation" className="hidden md:flex items-center gap-1">
          <Link href="/" className="rounded-lg px-3.5 py-2 text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-accent/50 hover:text-foreground">
            Create
          </Link>
          <Link href="/how-it-works" className="rounded-lg px-3.5 py-2 text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-accent/50 hover:text-foreground">
            How it works
          </Link>
          <a href="https://github.com/abhinandanhegde/VaultDrop" className="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-accent/50 hover:text-foreground" target="_blank" rel="noopener noreferrer">
            <Github className="h-4 w-4" />
            GitHub
          </a>
          <div className="ml-2 h-5 w-px bg-border/40" />
          <button aria-label="Toggle theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className={cn("relative flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-200", "text-muted-foreground hover:bg-accent/60 hover:text-foreground")}>
            {mounted && (
              <div className="relative h-4 w-4">
                <Sun className={cn("absolute inset-0 h-4 w-4 transition-all duration-300", theme === "dark" ? "rotate-0 scale-100 opacity-100" : "rotate-90 scale-0 opacity-0")} />
                <Moon className={cn("absolute inset-0 h-4 w-4 transition-all duration-300", theme === "dark" ? "-rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100")} />
              </div>
            )}
          </button>
        </nav>

        {/* Mobile nav */}
        <div className="md:hidden flex items-center gap-1">
          <button aria-label="Toggle theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="relative flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-all duration-200 hover:bg-accent/60 hover:text-foreground">
            {mounted && (
              <div className="relative h-4 w-4">
                <Sun className={cn("absolute inset-0 h-4 w-4 transition-all duration-300", theme === "dark" ? "rotate-0 scale-100 opacity-100" : "rotate-90 scale-0 opacity-0")} />
                <Moon className={cn("absolute inset-0 h-4 w-4 transition-all duration-300", theme === "dark" ? "-rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100")} />
              </div>
            )}
          </button>
          <button ref={menuButtonRef} aria-label="Toggle menu" aria-expanded={menuOpen} aria-controls="mobile-nav"
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-all duration-200 hover:bg-accent/60 hover:text-foreground">
            {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <nav id="mobile-nav" aria-label="Mobile navigation" className="md:hidden animate-slide-down border-t border-border/20 bg-background/90 backdrop-blur-2xl">
          <div className="mx-auto flex flex-col gap-1 px-4 py-3 max-w-6xl">
            <Link href="/" className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-colors hover:bg-accent/50" onClick={() => setMenuOpen(false)}>
              Create a drop
            </Link>
            <Link href="/how-it-works" className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-colors hover:bg-accent/50" onClick={() => setMenuOpen(false)}>
              How it works
            </Link>
            <a href="https://github.com/abhinandanhegde/VaultDrop" className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-colors hover:bg-accent/50" target="_blank" rel="noopener noreferrer" onClick={() => setMenuOpen(false)}>
              <Github className="h-4 w-4" />
              GitHub
            </a>
          </div>
        </nav>
      )}
    </header>
  );
}
