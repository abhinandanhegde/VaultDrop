"use client";

import Link from "next/link";
import {
  Lock, Eye, Clock, Flame, User, Server, Monitor,
  CheckCircle2, Send, KeyRound, FileCheck, Trash2,
  Globe, ShieldCheck, ArrowLeft,
} from "lucide-react";
import GlassCard from "@/components/glass-card";
import AnimatedSection from "@/components/animated-section";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    num: "01",
    title: "Create a delivery",
    desc: "Write a secret or upload a file. Give it a label, add recipients, and set the access policy — who can open it, when it expires, how many times it can be viewed.",
    icon: <Send className="h-5 w-5" />,
    color: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    detail: "Everything happens in your browser. The plaintext never touches the network.",
  },
  {
    num: "02",
    title: "Encrypt locally",
    desc: "Your browser derives an encryption key from the PIN using PBKDF2 (600,000 iterations), then encrypts the content with AES-256-GCM. For files, a random content key is generated and wrapped separately for each recipient.",
    icon: <Lock className="h-5 w-5" />,
    color: "text-purple-400 bg-purple-500/10 border-purple-500/20",
    detail: "By the time anything leaves your device, it is ciphertext. The server cannot read it.",
  },
  {
    num: "03",
    title: "Share through separate channels",
    desc: "Each recipient gets their own unique URL and a 6-digit PIN. Send the link through one channel (email, Slack) and the PIN through another (SMS, in person). Intercepting one reveals nothing.",
    icon: <Globe className="h-5 w-5" />,
    color: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    detail: "Two-channel distribution is the core of VaultDrop's access model.",
  },
  {
    num: "04",
    title: "Authenticate and access",
    desc: "The recipient opens the link and enters the PIN. The server verifies the hash — the raw PIN never reaches the backend. Policy checks happen: time-lock, expiry, view count, revocation status.",
    icon: <KeyRound className="h-5 w-5" />,
    color: "text-green-400 bg-green-500/10 border-green-500/20",
    detail: "Every check is server-side. A revoked link returns 410 Gone. A locked link returns 423.",
  },
  {
    num: "05",
    title: "Decrypt in your browser",
    desc: "The encrypted content is sent to the recipient's browser, where it is decrypted locally using the PIN-derived key. If anything was tampered with in transit, decryption fails.",
    icon: <FileCheck className="h-5 w-5" />,
    color: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
    detail: "Authenticated encryption (GCM) ensures integrity. Tampered content is rejected.",
  },
  {
    num: "06",
    title: "Destroyed when the policy is met",
    desc: "Once the conditions are satisfied — max views reached, expiry hit, burn-after-read triggered, or dead-man's switch expired — the ciphertext is permanently deleted from the server.",
    icon: <Trash2 className="h-5 w-5" />,
    color: "text-red-400 bg-red-500/10 border-red-500/20",
    detail: "Nothing remains on the server. The data is gone and cannot be recovered.",
  },
];

const POLICY_DIMS = [
  { label: "WHO", icon: <User className="h-4 w-4" />, color: "text-blue-400", desc: "Each recipient gets their own link, PIN, and independently encrypted copy. Revoking one does not affect others.", example: "Alice gets link A + PIN 123456. Bob gets link B + PIN 654321. Separate everything." },
  { label: "HOW", icon: <Lock className="h-4 w-4" />, color: "text-purple-400", desc: "6-digit PIN sent through a different channel than the URL. The server only stores the bcrypt hash — it never sees the raw PIN.", example: "Link shared via email, PIN sent via SMS. One intercepted channel doesn't compromise the secret." },
  { label: "WHEN", icon: <Clock className="h-4 w-4" />, color: "text-amber-400", desc: "Server-enforced time-lock (sealed until a chosen moment) and configurable expiry. No access possible before the time arrives.", example: "Release at 8 PM + expire after 24 hours. Before 8 PM, even the correct PIN returns 423." },
  { label: "HOW MANY", icon: <Eye className="h-4 w-4" />, color: "text-green-400", desc: "Atomic view counting with database-level locking. Concurrent opens are safe — exactly one winner. Burn-after-read destroys in the same transaction that serves.", example: "Max 3 views: first person opens (2 left), second opens (1 left), third opens (0 left — destroyed)." },
  { label: "AFTER", icon: <Flame className="h-4 w-4" />, color: "text-red-400", desc: "Burn-after-read, expiry, revocation, lockout, or dead-man's switch — every exit path deterministically destroys the ciphertext and file blobs.", example: "Burn after reading: opened once → ciphertext deleted in the same transaction that served it." },
];

const SECURITY_PRIMITIVES = [
  { name: "AES-256-GCM", role: "Encryption", detail: "Authenticated encryption with 128-bit tags. Provides confidentiality and integrity." },
  { name: "PBKDF2-SHA256", role: "Key derivation", detail: "600,000 iterations, 128-bit salt per copy. Resistant to brute-force attacks." },
  { name: "bcrypt", role: "PIN storage", detail: "Applied to SHA-256(pin) transport hash. Server never holds raw PINs." },
  { name: "SHA-256", role: "Transport hashing", detail: "Raw PIN hashed before leaving the browser on modern flows." },
];

const FAQ = [
  {
    q: "Can the server read my secrets?",
    a: "No. Content is encrypted in your browser with AES-256-GCM. The server stores only ciphertext and PIN hashes. It cannot decrypt your data — the key is derived from the PIN, which the server never sees.",
  },
  {
    q: "What if someone intercepts the link?",
    a: "Nothing. The link alone grants no access. The recipient must also know the 6-digit PIN, which should be sent through a different channel. Intercepting the link reveals only an encrypted blob address.",
  },
  {
    q: "What happens after a secret is destroyed?",
    a: "The ciphertext is permanently deleted from the database and any file blobs are removed from storage. There is no recovery. A subsequent request returns 410 Gone.",
  },
  {
    q: "How does the dead-man's switch work?",
    a: "The creator sets a renewal window (e.g., 10 minutes). Before the deadline, they must click 'Renew' in the dashboard. If they miss the window, the delivery self-destructs on next access and via the daily cleanup sweep.",
  },
  {
    q: "Is there a rate limit on PIN attempts?",
    a: "Yes. After 5 failed attempts, that recipient's copy is destroyed server-side. This uses database-backed sliding-window throttling that works across server restarts and instances.",
  },
  {
    q: "How are files encrypted?",
    a: "A random 256-bit content key encrypts the file once in the browser. That key is then wrapped separately for each recipient using their PIN. The server stores encrypted bytes in a private bucket — original filenames never appear in storage.",
  },
];

export default function HowItWorks() {
  return (
    <main id="main-content" className="relative min-h-screen pb-20">
      {/* ─── Hero ─── */}
      <section className="mx-auto max-w-4xl px-4 pt-10 pb-12 text-center sm:pt-16 sm:pb-16">
        <AnimatedSection animation="rise">
          <Link href="/" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground/60 transition-colors hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to create
          </Link>
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
            How <span className="gradient-text">VaultDrop</span> works
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground lg:text-lg">
            VaultDrop delivers secrets and files through a policy-driven lifecycle.
            Every step — encryption, authentication, access control, and destruction —
            is enforced by the server using data it cannot read.
          </p>
        </AnimatedSection>
      </section>

      {/* ─── 6-Step Flow ─── */}
      <section className="mx-auto max-w-4xl px-4 pb-16 sm:pb-20">
        <AnimatedSection animation="fade-in" delay={1}>
          <h2 className="mb-8 text-center text-lg font-bold tracking-tight sm:text-xl">The lifecycle</h2>
        </AnimatedSection>
        <div className="relative space-y-6">
          <div className="absolute left-6 top-0 bottom-0 hidden w-px bg-gradient-to-b from-blue-500/30 via-green-500/30 to-red-500/30 sm:block" aria-hidden="true" />
            {STEPS.map((step, i) => (
            <AnimatedSection key={step.num} animation="rise" delay={(i + 1) as 1 | 2 | 3 | 4 | 5 | 6}>
              <div className="relative flex gap-4 sm:gap-6">
                <div className="relative z-10 hidden flex-shrink-0 sm:block">
                  <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl border", step.color)}>
                    {step.icon}
                  </div>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-muted/30 font-mono text-xs font-bold text-muted-foreground sm:hidden">
                      {step.num}
                    </span>
                    <h3 className="text-base font-bold tracking-tight">{step.title}</h3>
                  </div>
                  <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground/70">{step.desc}</p>
                  <p className="mt-2 rounded-lg bg-primary/[0.04] px-3 py-2 text-xs text-primary/70">{step.detail}</p>
                </div>
              </div>
            </AnimatedSection>
          ))}
        </div>
      </section>

      {/* ─── Access Policy Deep Dive ─── */}
      <section className="mx-auto max-w-4xl px-4 pb-16 sm:pb-20">
        <AnimatedSection animation="fade-in">
          <div className="mb-8 text-center">
            <h2 className="text-lg font-bold tracking-tight sm:text-xl">The access policy model</h2>
            <p className="mt-2 text-sm text-muted-foreground/60">Every VaultDrop delivery answers five questions — and the server enforces every answer.</p>
          </div>
          <div className="space-y-4">
            {POLICY_DIMS.map((dim, i) => (
              <AnimatedSection key={dim.label} animation="rise" delay={(i + 1) as 1 | 2 | 3 | 4 | 5 | 6}>
                <GlassCard className="p-5 sm:p-6">
                  <div className="flex items-start gap-4">
                    <div className={cn("flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-muted/30", dim.color)}>
                      {dim.icon}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className={cn("text-xs font-bold uppercase tracking-widest", dim.color)}>{dim.label}</span>
                      </div>
                      <p className="mt-1.5 text-sm leading-relaxed text-foreground/80">{dim.desc}</p>
                      <p className="mt-2 rounded-lg bg-background/40 px-3 py-2 text-xs text-muted-foreground/50 italic">
                        Example: {dim.example}
                      </p>
                    </div>
                  </div>
                </GlassCard>
              </AnimatedSection>
            ))}
          </div>
        </AnimatedSection>
      </section>

      {/* ─── Security Primitives ─── */}
      <section className="mx-auto max-w-4xl px-4 pb-16 sm:pb-20">
        <AnimatedSection animation="fade-in">
          <div className="mb-8 text-center">
            <h2 className="text-lg font-bold tracking-tight sm:text-xl">Cryptographic primitives</h2>
            <p className="mt-2 text-sm text-muted-foreground/60">Standard, well-analyzed algorithms — used exactly as intended.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {SECURITY_PRIMITIVES.map((p, i) => (
              <AnimatedSection key={p.name} animation="pop-in" delay={(i + 1) as 1 | 2 | 3 | 4 | 5 | 6}>
                <div className="rounded-2xl border border-border/15 bg-card/30 p-5">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    <span className="font-mono text-sm font-bold">{p.name}</span>
                  </div>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-primary/60">{p.role}</p>
                  <p className="mt-2 text-sm text-muted-foreground/60">{p.detail}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </AnimatedSection>
      </section>

      {/* ─── Architecture ─── */}
      <section className="mx-auto max-w-4xl px-4 pb-16 sm:pb-20">
        <AnimatedSection animation="fade-in">
          <div className="mb-8 text-center">
            <h2 className="text-lg font-bold tracking-tight sm:text-xl">Architecture</h2>
            <p className="mt-2 text-sm text-muted-foreground/60">Three layers, strict separation.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-purple-500/15 bg-purple-500/[0.03] p-5">
              <div className="mb-3 flex items-center gap-2">
                <Monitor className="h-4 w-4 text-purple-400" />
                <span className="text-xs font-bold uppercase tracking-widest text-purple-400">Browser</span>
              </div>
              <ul className="space-y-1.5 text-sm text-muted-foreground/60">
                <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-purple-400/60" /> Key derivation</li>
                <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-purple-400/60" /> Encryption / decryption</li>
                <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-purple-400/60" /> Key wrapping</li>
                <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-purple-400/60" /> All plaintext handling</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-blue-500/15 bg-blue-500/[0.03] p-5">
              <div className="mb-3 flex items-center gap-2">
                <Server className="h-4 w-4 text-blue-400" />
                <span className="text-xs font-bold uppercase tracking-widest text-blue-400">Server</span>
              </div>
              <ul className="space-y-1.5 text-sm text-muted-foreground/60">
                <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-blue-400/60" /> Policy enforcement</li>
                <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-blue-400/60" /> PIN verification</li>
                <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-blue-400/60" /> Rate limiting</li>
                <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-blue-400/60" /> Atomic operations</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-green-500/15 bg-green-500/[0.03] p-5">
              <div className="mb-3 flex items-center gap-2">
                <Globe className="h-4 w-4 text-green-400" />
                <span className="text-xs font-bold uppercase tracking-widest text-green-400">Storage</span>
              </div>
              <ul className="space-y-1.5 text-sm text-muted-foreground/60">
                <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-400/60" /> Encrypted ciphertext</li>
                <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-400/60" /> Wrapped file keys</li>
                <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-400/60" /> Policy metadata</li>
                <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-400/60" /> Audit events</li>
              </ul>
            </div>
          </div>
        </AnimatedSection>
      </section>

      {/* ─── FAQ ─── */}
      <section className="mx-auto max-w-3xl px-4 pb-16 sm:pb-20">
        <AnimatedSection animation="fade-in">
          <div className="mb-8 text-center">
            <h2 className="text-lg font-bold tracking-tight sm:text-xl">Frequently asked questions</h2>
          </div>
          <div className="space-y-3">
            {FAQ.map((item, i) => (
              <AnimatedSection key={item.q} animation="rise" delay={(i + 1) as 1 | 2 | 3 | 4 | 5 | 6}>
                <GlassCard className="p-5">
                  <h3 className="text-sm font-bold">{item.q}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground/70">{item.a}</p>
                </GlassCard>
              </AnimatedSection>
            ))}
          </div>
        </AnimatedSection>
      </section>

      {/* ─── CTA ─── */}
      <section className="mx-auto max-w-3xl px-4 text-center">
        <AnimatedSection animation="pop-in">
          <GlassCard className="p-8 sm:p-10" glow>
            <h2 className="text-xl font-bold tracking-tight sm:text-2xl">Ready to send something securely?</h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground/60">
              No account required. No plaintext on the server. Just a secret, a policy, and a link.
            </p>
            <Link href="/#create" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-8 py-3.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:shadow-xl hover:shadow-primary/30 hover:scale-[1.02] active:scale-[0.98]">
              <Send className="h-4 w-4" /> Create a delivery
            </Link>
          </GlassCard>
        </AnimatedSection>
      </section>
    </main>
  );
}
