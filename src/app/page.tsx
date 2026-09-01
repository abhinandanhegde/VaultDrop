"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, useInView, AnimatePresence } from "framer-motion";
import {
  Lock, Plus, X, RefreshCw, User, Flame, Clock, Timer,
  HeartPulse, Eye, FileText, UploadCloud, Shield,
  ChevronDown, ChevronUp, Send, CheckCircle2, Server, Monitor,
  ArrowRight, ShieldCheck, Info, Globe, Sparkles, Zap, ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import GlassCard from "@/components/glass-card";
import ParticleField from "@/components/particle-field";
import TextScramble from "@/components/text-scramble";
import MagneticButton from "@/components/magnetic-button";
import TiltCard from "@/components/tilt-card";
import SpotlightCard from "@/components/spotlight-card";
import FloatingOrb from "@/components/floating-orb";
import GradientLine from "@/components/gradient-line";
import { cn } from "@/lib/utils";
import {
  encryptSecret,
  generatePIN,
  hashPinForTransport,
  generateFileKey,
  encryptBytesWithRawKey,
  wrapFileKeyForRecipient,
  ITERATIONS,
} from "@/lib/crypto";

const EXPIRY_OPTIONS = [
  { value: 300, label: "5 min" },
  { value: 3600, label: "1 hour" },
  { value: 14400, label: "4 hours" },
  { value: 86400, label: "1 day" },
  { value: 604800, label: "1 week" },
  { value: 0, label: "Never" },
] as const;

const MAX_RECIPIENTS = 10;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v % 1 === 0 ? v : v.toFixed(1)} ${units[u]}`;
}

interface RecipientDraft { id: number; name: string; pin: string; }

/* ── Scroll-triggered section wrapper ─── */
function RevealSection({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 40 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export default function Home() {
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [title, setTitle] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendMode, setSendMode] = useState<"secret" | "file">("secret");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [heroScrambleDone, setHeroScrambleDone] = useState(false);

  const [recipients, setRecipients] = useState<RecipientDraft[]>([{ id: 0, name: "", pin: "" }]);
  const [burnAfterReading, setBurnAfterReading] = useState(true);
  const [maxViews, setMaxViews] = useState(3);
  const [expirySeconds, setExpirySeconds] = useState(3600);
  const [releaseMode, setReleaseMode] = useState<"now" | "scheduled">("now");
  const [releaseAt, setReleaseAt] = useState("");
  const [deadManEnabled, setDeadManEnabled] = useState(false);
  const [renewalWindowMinutes, setRenewalWindowMinutes] = useState(10);

  useEffect(() => {
    setRecipients((rs) => rs.map((r) => (r.pin ? r : { ...r, pin: generatePIN() })));
    const timer = setTimeout(() => setHeroScrambleDone(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  const releaseValue = () => {
    if (releaseMode === "now") return null;
    if (!releaseAt) return null;
    const date = new Date(releaseAt);
    if (isNaN(date.getTime()) || date.getTime() <= Date.now()) return null;
    return releaseAt;
  };

  const addRecipient = () => {
    if (recipients.length >= MAX_RECIPIENTS) return;
    setRecipients([...recipients, { id: Date.now(), name: "", pin: generatePIN() }]);
  };

  const removeRecipient = (id: number) => {
    if (recipients.length <= 1) return;
    setRecipients(recipients.filter((r) => r.id !== id));
  };

  const updateRecipientName = (id: number, name: string) => {
    setRecipients(recipients.map((r) => (r.id === id ? { ...r, name } : r)));
  };

  const clampMaxViews = (raw: string) => {
    const n = parseInt(raw, 10);
    if (isNaN(n)) return 1;
    return Math.min(99, Math.max(1, n));
  };

  const regeneratePin = (id: number) => {
    setRecipients(recipients.map((r) => (r.id === id ? { ...r, pin: generatePIN() } : r)));
  };

  const expiryLabel = EXPIRY_OPTIONS.find((o) => o.value === expirySeconds)?.label || "1 hour";
  const policySummary = (() => {
    const parts: string[] = [];
    parts.push(`Available for ${expiryLabel.toLowerCase()}`);
    if (burnAfterReading) {
      parts.push("destroyed after first open");
    } else {
      parts.push(`up to ${maxViews} view${maxViews === 1 ? "" : "s"}`);
    }
    if (releaseMode === "scheduled" && releaseAt) {
      parts.push(`unlocks ${new Date(releaseAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`);
    }
    if (deadManEnabled) {
      parts.push(`renewal check-in every ${renewalWindowMinutes} min`);
    }
    return parts.join(". ") + ".";
  })();

  const handleDrop = async () => {
    if (sendMode === "secret" && !secret.trim()) { setError("Type or paste a secret first."); return; }
    if (sendMode === "file" && !selectedFile) { setError("Choose a file first."); return; }
    if (sendMode === "file" && selectedFile && selectedFile.size > MAX_FILE_BYTES) { setError(`That file is ${formatBytes(selectedFile.size)} — the limit is ${formatBytes(MAX_FILE_BYTES)}.`); return; }
    if (!title.trim()) { setError("Give it a label (e.g. \"API key\", \"Wi-Fi password\")."); return; }
    if (releaseMode === "scheduled" && !releaseValue()) { setError("Pick a release time in the future, or release it now."); return; }

    setError(null);
    setIsLoading(true);

    try {
      const expiresAt = expirySeconds > 0 ? new Date(Date.now() + expirySeconds * 1000).toISOString() : null;
      let response: Response;

      if (sendMode === "secret") {
        const encrypted = await Promise.all(recipients.map((r) => encryptSecret(secret, r.pin, ITERATIONS)));
        const recipientPayload = await Promise.all(recipients.map(async (r, i) => ({
          name: r.name.trim() || null,
          pin: await hashPinForTransport(r.pin),
          encryptedData: encrypted[i].encryptedData,
          nonce: encrypted[i].nonce,
          salt: encrypted[i].salt,
          iterations: encrypted[i].iterations,
        })));
        response = await fetch("/api/delivery", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipients: recipientPayload,
            maxViews: burnAfterReading ? 1 : maxViews,
            expiresAt,
            releaseAt: releaseValue(),
            renewalWindowMinutes: deadManEnabled ? renewalWindowMinutes : null,
            burnAfterReading,
            title,
            contentType: "text/plain",
          }),
        });
      } else {
        const dek = generateFileKey();
        const plainBytes = new Uint8Array(await selectedFile!.arrayBuffer());
        const { ciphertext, nonceB64 } = await encryptBytesWithRawKey(plainBytes, dek);
        const wrappedList = await Promise.all(recipients.map((r) => wrapFileKeyForRecipient(dek, r.pin)));
        dek.fill(0);
        const recipientPayload = await Promise.all(recipients.map(async (r, i) => ({
          name: r.name.trim() || null,
          pin: await hashPinForTransport(r.pin),
          wrapped: wrappedList[i],
        })));
        const form = new FormData();
        form.append("meta", JSON.stringify({
          recipients: recipientPayload,
          maxViews: burnAfterReading ? 1 : maxViews,
          expiresAt,
          releaseAt: releaseValue(),
          renewalWindowMinutes: deadManEnabled ? renewalWindowMinutes : null,
          burnAfterReading,
          title,
          fileName: selectedFile!.name,
          fileMime: selectedFile!.type || "",
          fileNonce: nonceB64,
        }));
        form.append("file", new Blob([ciphertext as unknown as BlobPart], { type: "application/octet-stream" }), "encrypted.bin");
        response = await fetch("/api/delivery/file", { method: "POST", body: form });
      }

      const data = await response.json();
      if (!response.ok || data.status === "error") throw new Error(data.message || "Failed to create delivery");
      setSecret("");
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.push(`/dashboard/${data.id}?token=${data.creatorToken}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  const lifecycleSteps = [
    { label: "Create", desc: "Write or upload", icon: <Sparkles className="h-5 w-5" />, color: "text-blue-400" },
    { label: "Encrypt", desc: "In your browser", icon: <Lock className="h-5 w-5" />, color: "text-purple-400" },
    { label: "Share", desc: "Separate channels", icon: <Send className="h-5 w-5" />, color: "text-amber-400" },
    { label: "Access", desc: "PIN verified", icon: <ShieldCheck className="h-5 w-5" />, color: "text-green-400" },
    { label: "Destroyed", desc: "Gone forever", icon: <Flame className="h-5 w-5" />, color: "text-red-400" },
  ];

  const features = [
    { icon: <Shield className="h-5 w-5" />, title: "Client-Side Encryption", desc: "AES-256-GCM in your browser", color: "text-blue-400" },
    { icon: <Zap className="h-5 w-5" />, title: "Zero-Knowledge Server", desc: "Server never sees plaintext", color: "text-amber-400" },
    { icon: <ShieldAlert className="h-5 w-5" />, title: "Self-Destructing", desc: "Burn after reading, auto-expire", color: "text-red-400" },
  ];

  return (
    <main id="main-content" className="relative min-h-screen">
      {/* ═══════════════════════════════════════════════════ */}
      {/* ─── HERO SECTION ─── */}
      {/* ═══════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden">
        {/* Particle field background */}
        <div className="absolute inset-0">
          <ParticleField />
        </div>

        {/* Floating orbs */}
        <FloatingOrb className="top-20 left-[10%]" size={400} color="hsl(var(--primary))" delay={0} />
        <FloatingOrb className="top-40 right-[5%]" size={300} color="hsl(270 80% 60%)" delay={5} />
        <FloatingOrb className="bottom-20 left-[40%]" size={350} color="hsl(180 80% 50%)" delay={10} />

        <div className="relative mx-auto max-w-5xl px-4 pt-16 pb-12 text-center sm:pt-24 sm:pb-16 lg:pt-32 lg:pb-20">
          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/[0.08] px-5 py-2 text-xs font-medium text-primary/80 backdrop-blur-sm">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              Client-side encrypted — server never sees plaintext
            </div>
          </motion.div>

          {/* Main heading with text scramble */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          >
            <h1 className="text-5xl font-bold tracking-tight sm:text-6xl lg:text-7xl xl:text-8xl">
              <span className="block">
                <TextScramble text="Share secrets." delay={300} trigger={true} />
              </span>
              <span className="block mt-2 gradient-text">
                <TextScramble text="Control access." delay={800} trigger={true} />
              </span>
            </h1>
          </motion.div>

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted-foreground lg:text-lg"
          >
            Encrypt in your browser. Define who can open them, when, how many times — then destroy them when the policy is met.
          </motion.p>

          {/* CTA buttons with magnetic effect */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.55, ease: [0.16, 1, 0.3, 1] }}
            className="mt-8 flex items-center justify-center gap-4"
          >
            <MagneticButton strength={0.2}>
              <a
                href="#create"
                className="btn-glow inline-flex items-center gap-2.5 rounded-2xl bg-primary px-8 py-4 text-sm font-semibold text-primary-foreground shadow-xl shadow-primary/25 transition-all hover:shadow-2xl hover:shadow-primary/35 hover:scale-[1.02] active:scale-[0.98]"
              >
                <Send className="h-4 w-4" /> Create a delivery
              </a>
            </MagneticButton>
            <MagneticButton strength={0.2}>
              <Link
                href="/how-it-works"
                className="inline-flex items-center gap-2 rounded-2xl border border-border/30 bg-background/40 px-8 py-4 text-sm font-semibold text-foreground/80 backdrop-blur-md transition-all hover:border-border/50 hover:bg-background/60 hover:shadow-lg"
              >
                How it works <ArrowRight className="h-4 w-4" />
              </Link>
            </MagneticButton>
          </motion.div>

          {/* Feature chips */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="mt-10 flex flex-wrap items-center justify-center gap-3"
          >
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, delay: 0.8 + i * 0.1 }}
                className="flex items-center gap-2 rounded-full border border-border/20 bg-card/30 px-4 py-2 text-xs font-medium backdrop-blur-sm"
              >
                <span className={f.color}>{f.icon}</span>
                <span className="text-foreground/70">{f.title}</span>
              </motion.div>
            ))}
          </motion.div>
        </div>

        {/* Bottom gradient fade */}
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent" />
      </section>

      {/* ─── Lifecycle Ribbon ─── */}
      <section className="mx-auto max-w-4xl px-4 py-12 sm:py-16">
        <RevealSection>
          <div className="flex items-center justify-center gap-0 overflow-x-auto">
            {lifecycleSteps.map((step, i) => (
              <div key={step.label} className="flex items-center flex-shrink-0">
                <motion.div
                  className="flex flex-col items-center gap-2 px-3 sm:px-6"
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1, duration: 0.5 }}
                >
                  <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl border border-border/20 bg-card/40 backdrop-blur-sm transition-all duration-300 hover:scale-110 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/10", step.color)}>
                    {step.icon}
                  </div>
                  <span className="text-xs font-bold tracking-wide text-foreground/90 sm:text-sm">{step.label}</span>
                  <span className="hidden text-[11px] text-muted-foreground/50 sm:block">{step.desc}</span>
                </motion.div>
                {i < lifecycleSteps.length - 1 && (
                  <div className="hidden sm:flex items-center">
                    <div className="h-px w-8 bg-gradient-to-r from-border/20 to-border/40" />
                    <ArrowRight className="h-3 w-3 text-border/30" />
                    <div className="h-px w-8 bg-gradient-to-r from-border/40 to-border/20" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </RevealSection>
      </section>

      <GradientLine className="mx-auto max-w-4xl" />

      {/* ═══════════════════════════════════════════════════ */}
      {/* ─── MAIN CONTENT: FORM + POLICY ─── */}
      {/* ═══════════════════════════════════════════════════ */}
      <section id="create" className="mx-auto max-w-4xl px-4 py-16 sm:py-20">
        <RevealSection>
          <TiltCard intensity={8}>
            <GlassCard className="overflow-hidden p-0 !bg-card/30 !backdrop-blur-2xl !border-border/10">
              <div className="p-5 sm:p-7 lg:p-8">
                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      role="alert"
                      className="mb-5 overflow-hidden rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400"
                    >
                      {error}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* ── Send mode ── */}
                <div className="mb-6">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground/50">Content</p>
                  <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Delivery type">
                    {[
                      { mode: "secret" as const, icon: <Lock className="h-5 w-5" />, label: "Text Secret", desc: "Passwords, API keys, notes" },
                      { mode: "file" as const, icon: <FileText className="h-5 w-5" />, label: "Encrypted File", desc: "PDFs, images, documents" },
                    ].map((m) => (
                      <SpotlightCard key={m.mode}>
                        <button type="button" role="radio" aria-checked={sendMode === m.mode} onClick={() => setSendMode(m.mode)}
                          className={cn("group relative flex w-full items-center gap-3 rounded-2xl border-2 p-4 text-left transition-all duration-300",
                            sendMode === m.mode ? "border-primary/40 bg-primary/[0.06] shadow-lg shadow-primary/5" : "border-border/15 hover:border-border/30 hover:bg-background/20"
                          )}>
                          <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl transition-colors", sendMode === m.mode ? "bg-primary/15 text-primary" : "bg-muted/30 text-muted-foreground")}>{m.icon}</span>
                          <span>
                            <span className="block text-sm font-semibold">{m.label}</span>
                            <span className="mt-0.5 block text-[11px] text-muted-foreground">{m.desc}</span>
                          </span>
                          {sendMode === m.mode && (
                            <motion.span
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full bg-primary shadow-lg shadow-primary/50"
                            />
                          )}
                        </button>
                      </SpotlightCard>
                    ))}
                  </div>
                </div>

                {/* ── Label ── */}
                <div>
                  <label className="mb-2 block text-sm font-semibold">Label</label>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Production API key, Wi-Fi password"
                    className="h-12 rounded-xl border-border/20 bg-background/30 backdrop-blur-sm transition-all focus-visible:border-primary/30 focus-visible:shadow-lg focus-visible:shadow-primary/5" aria-label="Label" />
                </div>

                {/* ── Secret / File ── */}
                {sendMode === "secret" ? (
                  <div className="mt-4">
                    <label className="mb-2 block text-sm font-semibold">Your secret</label>
                    <div className="relative">
                      <textarea value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Paste your secret here…" rows={5} autoFocus
                        className="w-full resize-y rounded-xl border border-border/20 bg-background/30 px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted-foreground/30 backdrop-blur-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary/30 focus-visible:shadow-lg focus-visible:shadow-primary/5"
                        aria-label="Secret content" />
                      {secret.length > 0 && <span className="absolute bottom-3 right-3 text-[10px] text-muted-foreground/30 tabular-nums">{secret.length} chars</span>}
                    </div>
                  </div>
                ) : selectedFile ? (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="mt-4 flex items-center gap-4 rounded-2xl border-2 border-dashed border-primary/20 bg-primary/[0.03] p-4"
                  >
                    <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-primary/10"><FileText className="h-7 w-7 text-primary" /></div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{selectedFile.name}</p>
                      <p className="text-xs text-muted-foreground">{formatBytes(selectedFile.size)} · {selectedFile.type || "unknown"}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" type="button" onClick={() => fileInputRef.current?.click()} className="rounded-xl">Replace</Button>
                      <Button variant="ghost" size="sm" type="button" aria-label="Remove file" onClick={() => { setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} className="rounded-xl text-red-400 hover:text-red-300">Remove</Button>
                    </div>
                  </motion.div>
                ) : (
                  <label htmlFor="vaultdrop-file-input"
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) setSelectedFile(f); }}
                    className={cn("mt-4 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-4 py-10 text-center transition-all duration-300",
                      dragging ? "border-primary/50 bg-primary/[0.06] scale-[1.01] shadow-lg shadow-primary/10" : "border-border/15 bg-background/15 hover:border-primary/20 hover:bg-background/25"
                    )}>
                    <motion.div
                      animate={dragging ? { scale: 1.1, rotate: 5 } : { scale: 1, rotate: 0 }}
                      className={cn("flex h-14 w-14 items-center justify-center rounded-2xl transition-colors", dragging ? "bg-primary/15" : "bg-muted/20")}
                    >
                      <UploadCloud className={cn("h-6 w-6 transition-colors", dragging ? "text-primary" : "text-muted-foreground")} />
                    </motion.div>
                    <span className="text-sm font-medium">Drop your file here, or <span className="text-primary underline underline-offset-2">browse</span></span>
                    <p className="text-[11px] text-muted-foreground">Encrypted in-browser · Max {formatBytes(MAX_FILE_BYTES)}</p>
                  </label>
                )}
                <input ref={fileInputRef} id="vaultdrop-file-input" type="file" className="sr-only" aria-label="Choose file"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) setSelectedFile(f); e.target.value = ""; }} />

                <GradientLine className="my-6" />

                {/* ────────────────────────────────────────────── */}
                {/* ── ACCESS POLICY — Bento Grid ── */}
                {/* ────────────────────────────────────────────── */}
                <div className="mt-6">
                  <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-muted-foreground/50">Access Policy</p>

                  <div className="bento-grid">
                    {/* WHO — spans 2 cols */}
                    <SpotlightCard className="sm:col-span-2 rounded-2xl border border-border/15 bg-card/20 p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <User className="h-4 w-4 text-blue-400" />
                        <span className="text-xs font-bold uppercase tracking-wider text-blue-400">Who</span>
                      </div>
                      <div className="space-y-2">
                        {recipients.map((r, i) => (
                          <motion.div
                            key={r.id}
                            layout
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="flex items-center gap-2"
                          >
                            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400"><User className="h-3.5 w-3.5" /></div>
                            <Input value={r.name} onChange={(e) => updateRecipientName(r.id, e.target.value)} placeholder={`Person ${i + 1}`}
                              className="h-8 flex-1 border-transparent bg-transparent text-xs focus-visible:ring-1" aria-label={`Recipient ${i + 1} name`} />
                            <span className="rounded-lg bg-primary/10 px-2.5 py-1 font-mono text-[11px] font-bold tracking-widest text-primary">{r.pin}</span>
                            <button type="button" onClick={() => regeneratePin(r.id)} className="rounded-lg p-1.5 text-muted-foreground/40 transition-colors hover:text-foreground hover:bg-muted/30" aria-label="Regenerate PIN"><RefreshCw className="h-3 w-3" /></button>
                            <button type="button" onClick={() => removeRecipient(r.id)} className="rounded-lg p-1.5 text-muted-foreground/40 transition-colors hover:text-red-400 hover:bg-red-500/10" aria-label="Remove recipient"><X className="h-3.5 w-3.5" /></button>
                          </motion.div>
                        ))}
                      </div>
                      <Button type="button" variant="ghost" size="sm" onClick={addRecipient} disabled={recipients.length >= MAX_RECIPIENTS}
                        className="mt-2 h-8 w-full rounded-xl text-xs text-primary hover:text-primary hover:bg-primary/5">
                        <Plus className="mr-1 h-3 w-3" /> Add person
                      </Button>
                    </SpotlightCard>

                    {/* HOW */}
                    <SpotlightCard className="rounded-2xl border border-border/15 bg-card/20 p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <Lock className="h-4 w-4 text-purple-400" />
                        <span className="text-xs font-bold uppercase tracking-wider text-purple-400">How</span>
                      </div>
                      <div className="space-y-2.5">
                        <div className="flex items-center gap-2.5 rounded-xl bg-purple-500/[0.06] px-3 py-2.5">
                          <ShieldCheck className="h-4 w-4 text-purple-400" />
                          <span className="text-sm font-medium">6-digit PIN</span>
                        </div>
                        <p className="text-[11px] leading-relaxed text-muted-foreground/50">Sent over a separate channel from the link. The server only sees the hash.</p>
                      </div>
                    </SpotlightCard>

                    {/* WHEN */}
                    <SpotlightCard className="rounded-2xl border border-border/15 bg-card/20 p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <Clock className="h-4 w-4 text-amber-400" />
                        <span className="text-xs font-bold uppercase tracking-wider text-amber-400">When</span>
                      </div>
                      <select value={expirySeconds} onChange={(e) => setExpirySeconds(Number(e.target.value))}
                        className="w-full rounded-xl border border-border/20 bg-background/30 px-3 py-2.5 text-sm backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label="Expiration">
                        {EXPIRY_OPTIONS.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
                      </select>
                      {releaseMode === "scheduled" && (
                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-2">
                          <input type="datetime-local" value={releaseAt} min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
                            onChange={(e) => setReleaseAt(e.target.value)}
                            className="w-full rounded-xl border border-border/20 bg-background/30 px-3 py-2 text-xs backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label="Release time" />
                        </motion.div>
                      )}
                    </SpotlightCard>

                    {/* HOW MANY */}
                    <SpotlightCard className="rounded-2xl border border-border/15 bg-card/20 p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <Eye className="h-4 w-4 text-green-400" />
                        <span className="text-xs font-bold uppercase tracking-wider text-green-400">How many</span>
                      </div>
                      {burnAfterReading ? (
                        <div className="flex items-center gap-2.5 rounded-xl bg-green-500/[0.06] px-3 py-2.5">
                          <Flame className="h-4 w-4 text-orange-400" />
                          <span className="text-sm font-medium">Once, then gone</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center overflow-hidden rounded-xl border border-border/20 bg-background/30">
                            <button type="button" onClick={() => setMaxViews((v) => Math.max(1, v - 1))} disabled={maxViews <= 1}
                              className="px-3 py-2 text-sm text-muted-foreground hover:bg-accent disabled:opacity-40" aria-label="Fewer">−</button>
                            <input type="number" inputMode="numeric" min={1} max={99} value={maxViews}
                              onChange={(e) => setMaxViews(clampMaxViews(e.target.value))} onBlur={(e) => setMaxViews(clampMaxViews(e.target.value))}
                              className="w-10 border-0 bg-transparent py-2 text-center text-sm tabular-nums [appearance:textfield] focus-visible:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                              aria-label="Views" />
                            <button type="button" onClick={() => setMaxViews((v) => Math.min(99, v + 1))} disabled={maxViews >= 99}
                              className="px-3 py-2 text-sm text-muted-foreground hover:bg-accent disabled:opacity-40" aria-label="More">+</button>
                          </span>
                          <span className="text-sm text-muted-foreground">views</span>
                        </div>
                      )}
                    </SpotlightCard>

                    {/* AFTER */}
                    <SpotlightCard className="rounded-2xl border border-border/15 bg-card/20 p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <Flame className="h-4 w-4 text-red-400" />
                        <span className="text-xs font-bold uppercase tracking-wider text-red-400">After access</span>
                      </div>
                      <button type="button" role="switch" aria-checked={burnAfterReading} onClick={() => setBurnAfterReading(!burnAfterReading)}
                        className="flex items-center gap-3 text-left">
                        <span className={cn("relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors duration-300", burnAfterReading ? "bg-primary shadow-lg shadow-primary/30" : "bg-muted")}>
                          <motion.span
                            animate={{ x: burnAfterReading ? 22 : 4 }}
                            transition={{ type: "spring", stiffness: 500, damping: 30 }}
                            className="inline-block h-5 w-5 rounded-full bg-white shadow-md"
                          />
                        </span>
                        <span className="text-sm font-medium">{burnAfterReading ? "Destroy after first read" : "Allow multiple opens"}</span>
                      </button>
                    </SpotlightCard>
                  </div>

                  {/* Advanced toggle */}
                  <motion.button type="button" onClick={() => setShowAdvanced(!showAdvanced)}
                    className="mt-4 flex w-full items-center justify-between rounded-2xl border border-border/10 bg-background/10 px-5 py-3 text-xs font-medium text-muted-foreground transition-all hover:border-border/25 hover:text-foreground/70 hover:bg-background/20"
                    aria-expanded={showAdvanced}>
                    <span className="flex items-center gap-2"><Info className="h-3.5 w-3.5 text-primary/50" /> Advanced: time-lock &amp; dead-man&apos;s switch</span>
                    <motion.span animate={{ rotate: showAdvanced ? 180 : 0 }} transition={{ duration: 0.2 }}>
                      <ChevronDown className="h-3.5 w-3.5" />
                    </motion.span>
                  </motion.button>

                  <AnimatePresence>
                    {showAdvanced && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.3 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <SpotlightCard className="rounded-2xl border border-border/15 bg-card/20 p-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="flex items-center gap-2 text-sm font-medium">
                                <Timer className={cn("h-4 w-4", releaseMode === "scheduled" ? "text-primary" : "text-muted-foreground")} />
                                Time-lock
                              </span>
                              <div className="flex gap-1 rounded-xl bg-background/50 p-0.5" role="radiogroup" aria-label="Release timing">
                                {(["now", "scheduled"] as const).map((mode) => (
                                  <button key={mode} type="button" role="radio" aria-checked={releaseMode === mode} onClick={() => setReleaseMode(mode)}
                                    className={cn("rounded-lg px-3 py-1.5 text-[11px] font-medium transition-all", releaseMode === mode ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                                    {mode === "now" ? "Now" : "Later"}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </SpotlightCard>
                          <SpotlightCard className="rounded-2xl border border-border/15 bg-card/20 p-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="flex items-center gap-2 text-sm font-medium">
                                <HeartPulse className={cn("h-4 w-4", deadManEnabled ? "text-red-400" : "text-muted-foreground")} />
                                Dead man&apos;s switch
                              </span>
                              <button type="button" role="switch" aria-checked={deadManEnabled} onClick={() => setDeadManEnabled((v) => !v)}
                                className={cn("relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-300", deadManEnabled ? "bg-red-500 shadow-lg shadow-red-500/30" : "bg-muted")}>
                                <motion.span
                                  animate={{ x: deadManEnabled ? 22 : 4 }}
                                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                  className="inline-block h-5 w-5 rounded-full bg-white shadow-md"
                                />
                              </button>
                            </div>
                            {deadManEnabled && (
                              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                                <select value={renewalWindowMinutes} onChange={(e) => setRenewalWindowMinutes(Number(e.target.value))}
                                  className="w-full rounded-xl border border-border/20 bg-background/30 px-3 py-2 text-xs backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  aria-label="Check-in interval">
                                  <option value={1}>Renew every 1 min</option>
                                  <option value={10}>Renew every 10 min</option>
                                  <option value={60}>Renew every 1 hour</option>
                                  <option value={1440}>Renew every 1 day</option>
                                </select>
                              </motion.div>
                            )}
                          </SpotlightCard>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* ── Live Policy Summary ── */}
                <motion.div
                  layout
                  className="mt-6 rounded-2xl border border-primary/10 bg-primary/[0.03] px-5 py-4 backdrop-blur-sm"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-primary/50 mb-1.5">Your delivery policy</p>
                  <p className="text-sm leading-relaxed text-foreground/80">{policySummary}</p>
                  <p className="mt-2 text-[11px] text-muted-foreground/40">This delivery will automatically become unavailable when its policy is satisfied.</p>
                </motion.div>
              </div>

              {/* ── Submit ── */}
              <div className="border-t border-border/10 bg-background/10 px-5 py-6 sm:px-7 lg:px-8">
                <MagneticButton strength={0.15}>
                  <Button className="btn-glow group relative w-full h-14 rounded-2xl text-base font-semibold shadow-xl shadow-primary/20 transition-all duration-300 hover:shadow-2xl hover:shadow-primary/30 hover:scale-[1.01] active:scale-[0.99]"
                    size="lg" onClick={handleDrop}
                    aria-busy={isLoading}
                    disabled={isLoading || !title.trim() || (sendMode === "secret" ? !secret.trim() : !selectedFile)}>
                    {isLoading ? (
                      <><Spinner className="mr-2 h-4 w-4" />{sendMode === "file" ? "Encrypting & uploading…" : `Sealing ${recipients.length} envelope${recipients.length > 1 ? "s" : ""}…`}</>
                    ) : (
                      <><Send className="mr-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />Create Secure Delivery</>
                    )}
                  </Button>
                </MagneticButton>
                <p className="mt-3 text-center text-[11px] text-muted-foreground/30">AES-256-GCM + PBKDF2-SHA256 · no sign-up · no plaintext on server</p>
              </div>
            </GlassCard>
          </TiltCard>
        </RevealSection>
      </section>

      {/* ─── Trust Model ─── */}
      <section className="mx-auto max-w-4xl px-4 pb-16 sm:pb-20">
        <RevealSection>
          <div className="mb-8 text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">What does VaultDrop know?</h2>
            <p className="mt-2 text-sm text-muted-foreground/60">The security boundary is your browser. The server enforces policy on ciphertext it cannot read.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TiltCard intensity={10}>
              <SpotlightCard className="rounded-2xl border border-green-500/15 bg-green-500/[0.03] p-6 h-full">
                <div className="mb-4 flex items-center gap-2">
                  <Monitor className="h-5 w-5 text-green-400" />
                  <span className="text-xs font-bold uppercase tracking-widest text-green-400">Your browser</span>
                </div>
                <ul className="space-y-3">
                  {[
                    "Secret plaintext — never leaves your device",
                    "Encryption & decryption — performed locally",
                    "PIN — entered here, never sent to server",
                    "Key derivation — PBKDF2 runs in-browser",
                  ].map((item, i) => (
                    <motion.li
                      key={item}
                      initial={{ opacity: 0, x: -10 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.1 }}
                      className="flex items-start gap-2.5 text-sm text-foreground/70"
                    >
                      <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500/60" />
                      {item}
                    </motion.li>
                  ))}
                </ul>
              </SpotlightCard>
            </TiltCard>
            <TiltCard intensity={10}>
              <SpotlightCard className="rounded-2xl border border-blue-500/15 bg-blue-500/[0.03] p-6 h-full">
                <div className="mb-4 flex items-center gap-2">
                  <Server className="h-5 w-5 text-blue-400" />
                  <span className="text-xs font-bold uppercase tracking-widest text-blue-400">VaultDrop server</span>
                </div>
                <ul className="space-y-3">
                  {[
                    "Encrypted ciphertext — unreadable without the PIN",
                    "PIN hash — bcrypt, not the raw PIN",
                    "Policy metadata — expiry, views, lifecycle",
                    "Audit events — timestamps, access attempts",
                  ].map((item, i) => (
                    <motion.li
                      key={item}
                      initial={{ opacity: 0, x: -10 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.1 }}
                      className="flex items-start gap-2.5 text-sm text-foreground/70"
                    >
                      <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500/60" />
                      {item}
                    </motion.li>
                  ))}
                </ul>
              </SpotlightCard>
            </TiltCard>
          </div>

          {/* Expandable explanation */}
          <motion.button type="button" onClick={() => setShowPrivacy(!showPrivacy)}
            className="mt-4 flex w-full items-center justify-between rounded-2xl border border-border/10 bg-background/10 px-5 py-3.5 text-xs font-medium text-muted-foreground/60 transition-all hover:border-border/25 hover:text-foreground/50 hover:bg-background/20"
            aria-expanded={showPrivacy}>
            <span className="flex items-center gap-2"><Globe className="h-3.5 w-3.5" /> Why is this secure?</span>
            <motion.span animate={{ rotate: showPrivacy ? 180 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronDown className="h-3.5 w-3.5" />
            </motion.span>
          </motion.button>
          <AnimatePresence>
            {showPrivacy && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden"
              >
                <div className="mt-3 rounded-2xl border border-border/10 bg-background/10 p-6 text-sm leading-relaxed text-muted-foreground/60 backdrop-blur-sm">
                  <p>Your secret is encrypted with <strong className="text-foreground/70">AES-256-GCM</strong> using a key derived from the recipient&apos;s PIN — entirely in your browser.
                    The server only stores ciphertext it cannot decrypt. The decryption key never leaves your device.</p>
                  <p className="mt-2">When the delivery is destroyed — whether by expiry, revocation, burn-after-read, or dead-man&apos;s switch — the ciphertext is permanently deleted.
                    Nothing can recover it.</p>
                  <div className="mt-4 flex items-center gap-2 text-xs text-green-400/80">
                    <Lock className="h-3.5 w-3.5" />
                    The server <strong>cannot</strong> decrypt your secret. Period.
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </RevealSection>
      </section>
    </main>
  );
}
