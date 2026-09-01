"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Lock, Plus, X, RefreshCw, User, Flame, Clock, Timer,
  HeartPulse, Eye, FileText, UploadCloud, Shield,
  ChevronDown, ChevronUp, Send, CheckCircle2, Server, Monitor,
  ArrowRight, ShieldCheck, Info, Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import GlassCard from "@/components/glass-card";
import AnimatedSection from "@/components/animated-section";
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
    { label: "Create", desc: "Write or upload", icon: "✏️" },
    { label: "Encrypt", desc: "In your browser", icon: "🔒" },
    { label: "Share", desc: "Separate channels", icon: "📤" },
    { label: "Access", desc: "PIN verified", icon: "🔓" },
    { label: "Destroyed", desc: "Gone forever", icon: "💀" },
  ];

  return (
    <main id="main-content" className="relative min-h-screen">
      {/* ─── Hero ─── */}
      <section className="relative mx-auto max-w-5xl px-4 pt-10 pb-8 text-center sm:pt-14 sm:pb-10 lg:pt-20 lg:pb-12">
        <AnimatedSection animation="rise">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/[0.06] px-4 py-1.5 text-xs font-medium text-primary/80 backdrop-blur-sm">
            <Shield className="h-3.5 w-3.5" />
            Client-side encrypted — server never sees plaintext
          </div>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-[3.5rem] xl:text-6xl">
            Share secrets.<br />
            <span className="gradient-text">Control access.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground lg:text-lg">
            Encrypt in your browser. Define who can open them, when, how many times — then destroy them when the policy is met.
          </p>
          <div className="mt-6 flex items-center justify-center gap-4">
            <a href="#create" className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:shadow-xl hover:shadow-primary/30 hover:scale-[1.02] active:scale-[0.98]">
              <Send className="h-4 w-4" /> Create a delivery
            </a>
            <Link href="/how-it-works" className="inline-flex items-center gap-2 rounded-xl border border-border/40 bg-background/50 px-6 py-3 text-sm font-semibold text-foreground/80 backdrop-blur-sm transition-all hover:border-border/60 hover:bg-background/70">
              How it works <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </AnimatedSection>
      </section>

      {/* ─── Lifecycle Ribbon ─── */}
      <section className="mx-auto max-w-4xl px-4 pb-10 sm:pb-14">
        <AnimatedSection animation="fade-in" delay={1}>
          <div className="flex items-center justify-center gap-0 overflow-x-auto">
            {lifecycleSteps.map((step, i) => (
              <div key={step.label} className="flex items-center flex-shrink-0">
                <div className="flex flex-col items-center gap-1.5 px-2 sm:px-5">
                  <span className="text-xl" aria-hidden="true">{step.icon}</span>
                  <span className="text-xs font-semibold tracking-wide text-foreground/90 sm:text-sm">{step.label}</span>
                  <span className="hidden text-[11px] text-muted-foreground/50 sm:block">{step.desc}</span>
                </div>
                {i < lifecycleSteps.length - 1 && (
                  <div className="hidden sm:flex items-center">
                    <div className="h-px w-6 bg-border/30 sm:w-10" />
                    <ArrowRight className="h-3 w-3 text-border/40" />
                    <div className="h-px w-6 bg-border/30 sm:w-10" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </AnimatedSection>
      </section>

      {/* ─── Main Content: Form + Policy ─── */}
      <section id="create" className="mx-auto max-w-4xl px-4 pb-16 sm:pb-20">
        <AnimatedSection animation="pop-in" delay={1}>
          <GlassCard className="overflow-hidden p-0 !bg-card/40 !backdrop-blur-xl !border-border/15">
            <div className="p-5 sm:p-7 lg:p-8">
              {error && (
                <div role="alert" className="mb-5 animate-shake rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">{error}</div>
              )}

              {/* ── Send mode ── */}
              <div className="mb-6">
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground/50">Content</p>
                <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Delivery type">
                  {[
                    { mode: "secret" as const, icon: "🔐", label: "Text Secret", desc: "Passwords, API keys, notes" },
                    { mode: "file" as const, icon: "📎", label: "Encrypted File", desc: "PDFs, images, documents" },
                  ].map((m) => (
                    <button key={m.mode} type="button" role="radio" aria-checked={sendMode === m.mode} onClick={() => setSendMode(m.mode)}
                      className={cn("group relative flex items-center gap-3 rounded-xl border-2 p-4 text-left transition-all duration-200",
                        sendMode === m.mode ? "border-primary/40 bg-primary/[0.06] shadow-sm" : "border-border/20 hover:border-border/40 hover:bg-background/30"
                      )}>
                      <span className="text-xl">{m.icon}</span>
                      <span>
                        <span className="block text-sm font-semibold">{m.label}</span>
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">{m.desc}</span>
                      </span>
                      {sendMode === m.mode && <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-primary animate-fade-in" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Label ── */}
              <div>
                <label className="mb-2 block text-sm font-semibold">Label</label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Production API key, Wi-Fi password"
                  className="h-11 rounded-xl border-border/30 bg-background/40" aria-label="Label" />
              </div>

              {/* ── Secret / File ── */}
              {sendMode === "secret" ? (
                <div className="mt-4">
                  <label className="mb-2 block text-sm font-semibold">Your secret</label>
                  <div className="relative">
                    <textarea value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Paste your secret here…" rows={5} autoFocus
                      className="w-full resize-y rounded-xl border border-border/30 bg-background/40 px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted-foreground/40 transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:shadow-lg focus-visible:shadow-primary/5"
                      aria-label="Secret content" />
                    {secret.length > 0 && <span className="absolute bottom-3 right-3 text-[10px] text-muted-foreground/30 tabular-nums">{secret.length} chars</span>}
                  </div>
                </div>
              ) : selectedFile ? (
                <div className="mt-4 flex items-center gap-4 rounded-xl border-2 border-dashed border-primary/20 bg-primary/[0.03] p-4">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10"><FileText className="h-6 w-6 text-primary" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{selectedFile.name}</p>
                    <p className="text-xs text-muted-foreground">{formatBytes(selectedFile.size)} · {selectedFile.type || "unknown"}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" type="button" onClick={() => fileInputRef.current?.click()} className="rounded-lg">Replace</Button>
                    <Button variant="ghost" size="sm" type="button" aria-label="Remove file" onClick={() => { setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} className="rounded-lg text-red-400 hover:text-red-300">Remove</Button>
                  </div>
                </div>
              ) : (
                <label htmlFor="vaultdrop-file-input"
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) setSelectedFile(f); }}
                  className={cn("mt-4 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-all duration-200",
                    dragging ? "border-primary/50 bg-primary/[0.06] scale-[1.01]" : "border-border/20 bg-background/20 hover:border-primary/20 hover:bg-background/30"
                  )}>
                  <div className={cn("flex h-11 w-11 items-center justify-center rounded-2xl transition-colors", dragging ? "bg-primary/15" : "bg-muted/30")}>
                    <UploadCloud className={cn("h-5 w-5 transition-colors", dragging ? "text-primary" : "text-muted-foreground")} />
                  </div>
                  <span className="text-sm font-medium">Drop your file here, or <span className="text-primary underline underline-offset-2">browse</span></span>
                  <p className="text-[11px] text-muted-foreground">Encrypted in-browser · Max {formatBytes(MAX_FILE_BYTES)}</p>
                </label>
              )}
              <input ref={fileInputRef} id="vaultdrop-file-input" type="file" className="sr-only" aria-label="Choose file"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) setSelectedFile(f); e.target.value = ""; }} />

              <div className="mt-6 h-px bg-gradient-to-r from-transparent via-border/30 to-transparent" />

              {/* ────────────────────────────────────────────── */}
              {/* ── ACCESS POLICY — First-class concept ── */}
              {/* ────────────────────────────────────────────── */}
              <div className="mt-6">
                <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-muted-foreground/50">Access Policy</p>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {/* WHO */}
                  <div className="rounded-xl border border-border/20 bg-background/20 p-4 sm:col-span-2 lg:col-span-1">
                    <div className="mb-3 flex items-center gap-2">
                      <User className="h-4 w-4 text-blue-400" />
                      <span className="text-xs font-bold uppercase tracking-wider text-blue-400">Who</span>
                    </div>
                    <div className="space-y-2">
                      {recipients.map((r, i) => (
                        <div key={r.id} className="flex items-center gap-2">
                          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-muted/40 text-muted-foreground"><User className="h-3.5 w-3.5" /></div>
                          <Input value={r.name} onChange={(e) => updateRecipientName(r.id, e.target.value)} placeholder={`Person ${i + 1}`}
                            className="h-7 flex-1 border-transparent bg-transparent text-xs focus-visible:ring-1" aria-label={`Recipient ${i + 1} name`} />
                          <span className="rounded-md bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-bold tracking-widest text-primary">{r.pin}</span>
                          <button type="button" onClick={() => regeneratePin(r.id)} className="rounded-md p-1 text-muted-foreground/50 transition-colors hover:text-foreground" aria-label="Regenerate PIN"><RefreshCw className="h-3 w-3" /></button>
                          <button type="button" onClick={() => removeRecipient(r.id)} className="rounded-md p-1 text-muted-foreground/50 transition-colors hover:text-red-400" aria-label="Remove recipient"><X className="h-3.5 w-3.5" /></button>
                        </div>
                      ))}
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={addRecipient} disabled={recipients.length >= MAX_RECIPIENTS}
                      className="mt-2 h-7 w-full rounded-lg text-xs text-primary hover:text-primary">
                      <Plus className="mr-1 h-3 w-3" /> Add person
                    </Button>
                  </div>

                  {/* HOW */}
                  <div className="rounded-xl border border-border/20 bg-background/20 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Lock className="h-4 w-4 text-purple-400" />
                      <span className="text-xs font-bold uppercase tracking-wider text-purple-400">How</span>
                    </div>
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-2.5 rounded-lg bg-purple-500/[0.06] px-3 py-2">
                        <ShieldCheck className="h-4 w-4 text-purple-400" />
                        <span className="text-sm font-medium">6-digit PIN</span>
                      </div>
                      <p className="text-[11px] leading-relaxed text-muted-foreground/50">Sent over a separate channel from the link. The server only sees the hash.</p>
                    </div>
                  </div>

                  {/* WHEN */}
                  <div className="rounded-xl border border-border/20 bg-background/20 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Clock className="h-4 w-4 text-amber-400" />
                      <span className="text-xs font-bold uppercase tracking-wider text-amber-400">When</span>
                    </div>
                    <select value={expirySeconds} onChange={(e) => setExpirySeconds(Number(e.target.value))}
                      className="w-full rounded-lg border border-border/30 bg-background/40 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label="Expiration">
                      {EXPIRY_OPTIONS.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
                    </select>
                    {releaseMode === "scheduled" && (
                      <div className="mt-2 animate-fade-in">
                        <input type="datetime-local" value={releaseAt} min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
                          onChange={(e) => setReleaseAt(e.target.value)}
                          className="w-full rounded-lg border border-border/30 bg-background/40 px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label="Release time" />
                      </div>
                    )}
                  </div>

                  {/* HOW MANY */}
                  <div className="rounded-xl border border-border/20 bg-background/20 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Eye className="h-4 w-4 text-green-400" />
                      <span className="text-xs font-bold uppercase tracking-wider text-green-400">How many</span>
                    </div>
                    {burnAfterReading ? (
                      <div className="flex items-center gap-2.5 rounded-lg bg-green-500/[0.06] px-3 py-2">
                        <Flame className="h-4 w-4 text-orange-400" />
                        <span className="text-sm font-medium">Once, then gone</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center overflow-hidden rounded-lg border border-border/30 bg-background/40">
                          <button type="button" onClick={() => setMaxViews((v) => Math.max(1, v - 1))} disabled={maxViews <= 1}
                            className="px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-accent disabled:opacity-40" aria-label="Fewer">−</button>
                          <input type="number" inputMode="numeric" min={1} max={99} value={maxViews}
                            onChange={(e) => setMaxViews(clampMaxViews(e.target.value))} onBlur={(e) => setMaxViews(clampMaxViews(e.target.value))}
                            className="w-10 border-0 bg-transparent py-1.5 text-center text-sm tabular-nums [appearance:textfield] focus-visible:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            aria-label="Views" />
                          <button type="button" onClick={() => setMaxViews((v) => Math.min(99, v + 1))} disabled={maxViews >= 99}
                            className="px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-accent disabled:opacity-40" aria-label="More">+</button>
                        </span>
                        <span className="text-sm text-muted-foreground">views</span>
                      </div>
                    )}
                  </div>

                  {/* AFTER */}
                  <div className="rounded-xl border border-border/20 bg-background/20 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Flame className="h-4 w-4 text-red-400" />
                      <span className="text-xs font-bold uppercase tracking-wider text-red-400">After access</span>
                    </div>
                    <button type="button" role="switch" aria-checked={burnAfterReading} onClick={() => setBurnAfterReading(!burnAfterReading)}
                      className="flex items-center gap-3 text-left">
                      <span className={cn("relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors", burnAfterReading ? "bg-primary" : "bg-muted")}>
                        <span className={cn("inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform", burnAfterReading ? "translate-x-5" : "translate-x-1")} />
                      </span>
                      <span className="text-sm font-medium">{burnAfterReading ? "Destroy after first read" : "Allow multiple opens"}</span>
                    </button>
                  </div>
                </div>

                {/* Advanced toggle */}
                <button type="button" onClick={() => setShowAdvanced(!showAdvanced)}
                  className="mt-3 flex w-full items-center justify-between rounded-xl border border-border/15 bg-background/10 px-4 py-2.5 text-xs font-medium text-muted-foreground transition-all hover:border-border/30 hover:text-foreground/70"
                  aria-expanded={showAdvanced}>
                  <span className="flex items-center gap-2"><Info className="h-3.5 w-3.5 text-primary/50" /> Advanced: time-lock &amp; dead-man&apos;s switch</span>
                  {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>

                {showAdvanced && (
                  <div className="mt-3 grid animate-fade-in gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-border/20 bg-background/20 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <Timer className={cn("h-4 w-4", releaseMode === "scheduled" ? "text-primary" : "text-muted-foreground")} />
                          Time-lock
                        </span>
                        <div className="flex gap-1 rounded-lg bg-background/50 p-0.5" role="radiogroup" aria-label="Release timing">
                          {(["now", "scheduled"] as const).map((mode) => (
                            <button key={mode} type="button" role="radio" aria-checked={releaseMode === mode} onClick={() => setReleaseMode(mode)}
                              className={cn("rounded-md px-2.5 py-1 text-[11px] font-medium transition-all", releaseMode === mode ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                              {mode === "now" ? "Now" : "Later"}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="rounded-xl border border-border/20 bg-background/20 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <HeartPulse className={cn("h-4 w-4", deadManEnabled ? "text-red-400" : "text-muted-foreground")} />
                          Dead man&apos;s switch
                        </span>
                        <button type="button" role="switch" aria-checked={deadManEnabled} onClick={() => setDeadManEnabled((v) => !v)}
                          className={cn("relative inline-flex h-6 w-11 items-center rounded-full transition-colors", deadManEnabled ? "bg-red-500" : "bg-muted")}>
                          <span className={cn("inline-block h-4 w-4 transform rounded-full bg-background shadow-md transition-transform", deadManEnabled ? "translate-x-6" : "translate-x-1")} />
                        </button>
                      </div>
                      {deadManEnabled && (
                        <select value={renewalWindowMinutes} onChange={(e) => setRenewalWindowMinutes(Number(e.target.value))}
                          className="w-full rounded-lg border border-border/30 bg-background/40 px-2.5 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label="Check-in interval">
                          <option value={1}>Renew every 1 min</option>
                          <option value={10}>Renew every 10 min</option>
                          <option value={60}>Renew every 1 hour</option>
                          <option value={1440}>Renew every 1 day</option>
                        </select>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* ── Live Policy Summary ── */}
              <div className="mt-6 rounded-xl border border-primary/10 bg-primary/[0.03] px-5 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-primary/50 mb-1.5">Your delivery policy</p>
                <p className="text-sm leading-relaxed text-foreground/80">{policySummary}</p>
                <p className="mt-2 text-[11px] text-muted-foreground/40">This delivery will automatically become unavailable when its policy is satisfied.</p>
              </div>
            </div>

            {/* ── Submit ── */}
            <div className="border-t border-border/15 bg-background/15 px-5 py-5 sm:px-7 lg:px-8">
              <Button className="group relative w-full h-13 rounded-xl text-base font-semibold shadow-lg shadow-primary/20 transition-all duration-300 hover:shadow-xl hover:shadow-primary/30 hover:scale-[1.01] active:scale-[0.99]"
                size="lg" onClick={handleDrop}
                aria-busy={isLoading}
                disabled={isLoading || !title.trim() || (sendMode === "secret" ? !secret.trim() : !selectedFile)}>
                {isLoading ? (
                  <><Spinner className="mr-2 h-4 w-4" />{sendMode === "file" ? "Encrypting & uploading…" : `Sealing ${recipients.length} envelope${recipients.length > 1 ? "s" : ""}…`}</>
                ) : (
                  <><Send className="mr-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />Create Secure Delivery</>
                )}
              </Button>
              <p className="mt-2.5 text-center text-[11px] text-muted-foreground/35">AES-256-GCM + PBKDF2-SHA256 · no sign-up · no plaintext on server</p>
            </div>
          </GlassCard>
        </AnimatedSection>
      </section>

      {/* ─── Trust Model ─── */}
      <section className="mx-auto max-w-4xl px-4 pb-16 sm:pb-20">
        <AnimatedSection animation="fade-in" delay={2}>
          <div className="mb-5 text-center">
            <h2 className="text-lg font-bold tracking-tight sm:text-xl">What does VaultDrop know?</h2>
            <p className="mt-1 text-sm text-muted-foreground/60">The security boundary is your browser. The server enforces policy on ciphertext it cannot read.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-green-500/15 bg-green-500/[0.03] p-5">
              <div className="mb-3 flex items-center gap-2">
                <Monitor className="h-4.5 w-4.5 text-green-400" />
                <span className="text-xs font-bold uppercase tracking-widest text-green-400">Your browser</span>
              </div>
              <ul className="space-y-2">
                {[
                  "Secret plaintext — never leaves your device",
                  "Encryption & decryption — performed locally",
                  "PIN — entered here, never sent to server",
                  "Key derivation — PBKDF2 runs in-browser",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-foreground/70">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-green-500/60" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-blue-500/15 bg-blue-500/[0.03] p-5">
              <div className="mb-3 flex items-center gap-2">
                <Server className="h-4.5 w-4.5 text-blue-400" />
                <span className="text-xs font-bold uppercase tracking-widest text-blue-400">VaultDrop server</span>
              </div>
              <ul className="space-y-2">
                {[
                  "Encrypted ciphertext — unreadable without the PIN",
                  "PIN hash — bcrypt, not the raw PIN",
                  "Policy metadata — expiry, views, lifecycle",
                  "Audit events — timestamps, access attempts",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-foreground/70">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-blue-500/60" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Expandable explanation */}
          <button type="button" onClick={() => setShowPrivacy(!showPrivacy)}
            className="mt-4 flex w-full items-center justify-between rounded-xl border border-border/15 bg-background/10 px-4 py-3 text-xs font-medium text-muted-foreground/60 transition-all hover:border-border/30 hover:text-foreground/50"
            aria-expanded={showPrivacy}>
            <span className="flex items-center gap-2"><Globe className="h-3.5 w-3.5" /> Why is this secure?</span>
            {showPrivacy ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {showPrivacy && (
            <div className="mt-3 animate-fade-in rounded-xl border border-border/15 bg-background/10 p-5 text-sm leading-relaxed text-muted-foreground/60">
              <p>Your secret is encrypted with <strong className="text-foreground/70">AES-256-GCM</strong> using a key derived from the recipient&apos;s PIN — entirely in your browser.
                The server only stores ciphertext it cannot decrypt. The decryption key never leaves your device.</p>
              <p className="mt-2">When the delivery is destroyed — whether by expiry, revocation, burn-after-read, or dead-man&apos;s switch — the ciphertext is permanently deleted.
                Nothing can recover it.</p>
              <div className="mt-4 flex items-center gap-2 text-xs text-green-400/80">
                <Lock className="h-3.5 w-3.5" />
                The server <strong>cannot</strong> decrypt your secret. Period.
              </div>
            </div>
          )}
        </AnimatedSection>
      </section>
    </main>
  );
}
