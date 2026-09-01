import { Lock } from "lucide-react";

export default function Footer() {
  return (
    <footer className="relative border-t border-border/20 bg-background/50 backdrop-blur-sm">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2 text-xs text-muted-foreground/40">
          <div className="flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-primary/20 to-purple-500/20">
            <Lock className="h-2.5 w-2.5 text-primary/60" aria-hidden="true" />
          </div>
          <span className="font-medium">VaultDrop</span>
          <span className="hidden sm:inline">· End-to-end encrypted</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground/40">
          <span className="hidden sm:inline">AES-256-GCM · PBKDF2-SHA256</span>
          <a
            href="https://github.com/abhinandanhegde/VaultDrop"
            className="transition-colors hover:text-muted-foreground/70"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}
