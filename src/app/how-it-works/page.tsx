"use client";

import { useRef } from "react";
import Link from "next/link";
import { motion, useInView } from "framer-motion";
import {
  Lock, Eye, Clock, Flame, User, Server, Monitor,
  CheckCircle2, Send, KeyRound, FileCheck, Trash2,
  Globe, ShieldCheck, ArrowLeft, Sparkles, Shield,
} from "lucide-react";
import GlassCard from "@/components/glass-card";
import TiltCard from "@/components/tilt-card";
import SpotlightCard from "@/components/spotlight-card";
import MagneticButton from "@/components/magnetic-button";
import FloatingOrb from "@/components/floating-orb";
import GradientLine from "@/components/gradient-line";
import TextScramble from "@/components/text-scramble";
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

export default function HowItWorks() {
  return (
    <main id="main-content" className="relative min-h-screen pb-20 overflow-hidden">
      {/* Background orbs */}
      <FloatingOrb className="top-20 left-[10%]" size={400} color="hsl(var(--primary))" delay={0} />
      <FloatingOrb className="top-60 right-[5%]" size={300} color="hsl(270 80% 60%)" delay={5} />
      <FloatingOrb className="bottom-40 left-[30%]" size={350} color="hsl(180 80% 50%)" delay={10} />

      {/* ─── Hero ─── */}
      <section className="mx-auto max-w-4xl px-4 pt-10 pb-12 text-center sm:pt-16 sm:pb-16">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          <Link href="/" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground/60 transition-colors hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to create
          </Link>
          <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            How <span className="gradient-text">VaultDrop</span> works
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground lg:text-lg">
            VaultDrop delivers secrets and files through a policy-driven lifecycle.
            Every step — encryption, authentication, access control, and destruction —
            is enforced by the server using data it cannot read.
          </p>
        </motion.div>
      </section>

      {/* ─── 6-Step Flow ─── */}
      <section className="mx-auto max-w-4xl px-4 pb-16 sm:pb-20">
        <RevealSection>
          <h2 className="mb-10 text-center text-xl font-bold tracking-tight sm:text-2xl">The lifecycle</h2>
        </RevealSection>
        <div className="relative space-y-8">
          {/* Animated timeline line */}
          <div className="absolute left-6 top-0 bottom-0 hidden w-px sm:block" aria-hidden="true">
            <div className="h-full bg-gradient-to-b from-blue-500/30 via-green-500/30 to-red-500/30" />
          </div>
          {STEPS.map((step, i) => (
            <RevealSection key={step.num} delay={i * 0.08}>
              <div className="relative flex gap-4 sm:gap-6">
                <div className="relative z-10 hidden flex-shrink-0 sm:block">
                  <motion.div
                    whileHover={{ scale: 1.15, rotate: 5 }}
                    className={cn("flex h-14 w-14 items-center justify-center rounded-2xl border transition-shadow hover:shadow-lg", step.color)}
                  >
                    {step.icon}
                  </motion.div>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-muted/30 font-mono text-xs font-bold text-muted-foreground sm:hidden">
                      {step.num}
                    </span>
                    <h3 className="text-lg font-bold tracking-tight">{step.title}</h3>
                  </div>
                  <p className="mt-2.5 max-w-lg text-sm leading-relaxed text-muted-foreground/70">{step.desc}</p>
                  <motion.div
                    initial={{ opacity: 0, width: 0 }}
                    whileInView={{ opacity: 1, width: "100%" }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.3, duration: 0.5 }}
                    className="mt-3 overflow-hidden"
                  >
                    <div className="rounded-xl bg-primary/[0.04] px-4 py-2.5 text-xs text-primary/70 backdrop-blur-sm">{step.detail}</div>
                  </motion.div>
                </div>
              </div>
            </RevealSection>
          ))}
        </div>
      </section>

      <GradientLine className="mx-auto max-w-4xl" />

      {/* ─── Access Policy Deep Dive ─── */}
      <section className="mx-auto max-w-4xl px-4 py-16 sm:py-20">
        <RevealSection>
          <div className="mb-10 text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">The access policy model</h2>
            <p className="mt-2 text-sm text-muted-foreground/60">Every VaultDrop delivery answers five questions — and the server enforces every answer.</p>
          </div>
          <div className="space-y-4">
            {POLICY_DIMS.map((dim, i) => (
              <RevealSection key={dim.label} delay={i * 0.08}>
                <TiltCard intensity={6}>
                  <SpotlightCard className="rounded-2xl border border-border/15 bg-card/20 p-5 sm:p-6 backdrop-blur-sm">
                    <div className="flex items-start gap-4">
                      <motion.div
                        whileHover={{ scale: 1.1, rotate: 5 }}
                        className={cn("flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-muted/30", dim.color)}
                      >
                        {dim.icon}
                      </motion.div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className={cn("text-xs font-bold uppercase tracking-widest", dim.color)}>{dim.label}</span>
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-foreground/80">{dim.desc}</p>
                        <p className="mt-3 rounded-xl bg-background/30 px-4 py-2.5 text-xs text-muted-foreground/50 italic backdrop-blur-sm">
                          Example: {dim.example}
                        </p>
                      </div>
                    </div>
                  </SpotlightCard>
                </TiltCard>
              </RevealSection>
            ))}
          </div>
        </RevealSection>
      </section>

      <GradientLine className="mx-auto max-w-4xl" />

      {/* ─── Security Primitives ─── */}
      <section className="mx-auto max-w-4xl px-4 py-16 sm:py-20">
        <RevealSection>
          <div className="mb-10 text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Cryptographic primitives</h2>
            <p className="mt-2 text-sm text-muted-foreground/60">Standard, well-analyzed algorithms — used exactly as intended.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {SECURITY_PRIMITIVES.map((p, i) => (
              <RevealSection key={p.name} delay={i * 0.08}>
                <TiltCard intensity={8}>
                  <SpotlightCard className="rounded-2xl border border-border/15 bg-card/20 p-6 backdrop-blur-sm h-full">
                    <div className="flex items-center gap-2.5">
                      <ShieldCheck className="h-5 w-5 text-primary" />
                      <span className="font-mono text-base font-bold">{p.name}</span>
                    </div>
                    <p className="mt-1.5 text-xs font-semibold uppercase tracking-wider text-primary/60">{p.role}</p>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground/60">{p.detail}</p>
                  </SpotlightCard>
                </TiltCard>
              </RevealSection>
            ))}
          </div>
        </RevealSection>
      </section>

      {/* ─── Architecture ─── */}
      <section className="mx-auto max-w-4xl px-4 pb-16 sm:pb-20">
        <RevealSection>
          <div className="mb-10 text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Architecture</h2>
            <p className="mt-2 text-sm text-muted-foreground/60">Three layers, strict separation.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { icon: <Monitor className="h-5 w-5" />, title: "Browser", color: "purple", items: ["Key derivation", "Encryption / decryption", "Key wrapping", "All plaintext handling"] },
              { icon: <Server className="h-5 w-5" />, title: "Server", color: "blue", items: ["Policy enforcement", "PIN verification", "Rate limiting", "Atomic operations"] },
              { icon: <Globe className="h-5 w-5" />, title: "Storage", color: "green", items: ["Encrypted ciphertext", "Wrapped file keys", "Policy metadata", "Audit events"] },
            ].map((layer, i) => (
              <RevealSection key={layer.title} delay={i * 0.1}>
                <TiltCard intensity={10}>
                  <SpotlightCard className={cn("rounded-2xl border p-6 h-full backdrop-blur-sm",
                    layer.color === "purple" ? "border-purple-500/15 bg-purple-500/[0.03]" :
                    layer.color === "blue" ? "border-blue-500/15 bg-blue-500/[0.03]" :
                    "border-green-500/15 bg-green-500/[0.03]"
                  )}>
                    <div className="mb-4 flex items-center gap-2.5">
                      <span className={cn(layer.color === "purple" ? "text-purple-400" : layer.color === "blue" ? "text-blue-400" : "text-green-400")}>{layer.icon}</span>
                      <span className={cn("text-xs font-bold uppercase tracking-widest", layer.color === "purple" ? "text-purple-400" : layer.color === "blue" ? "text-blue-400" : "text-green-400")}>{layer.title}</span>
                    </div>
                    <ul className="space-y-2.5">
                      {layer.items.map((item) => (
                        <li key={item} className="flex items-center gap-2 text-sm text-muted-foreground/60">
                          <CheckCircle2 className={cn("h-3.5 w-3.5 flex-shrink-0", layer.color === "purple" ? "text-purple-400/60" : layer.color === "blue" ? "text-blue-400/60" : "text-green-400/60")} />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </SpotlightCard>
                </TiltCard>
              </RevealSection>
            ))}
          </div>
        </RevealSection>
      </section>

      <GradientLine className="mx-auto max-w-3xl" />

      {/* ─── FAQ ─── */}
      <section className="mx-auto max-w-3xl px-4 py-16 sm:py-20">
        <RevealSection>
          <div className="mb-10 text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Frequently asked questions</h2>
          </div>
          <div className="space-y-4">
            {FAQ.map((item, i) => (
              <RevealSection key={item.q} delay={i * 0.06}>
                <SpotlightCard className="rounded-2xl border border-border/15 bg-card/20 p-6 backdrop-blur-sm">
                  <h3 className="text-sm font-bold">{item.q}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground/70">{item.a}</p>
                </SpotlightCard>
              </RevealSection>
            ))}
          </div>
        </RevealSection>
      </section>

      {/* ─── CTA ─── */}
      <section className="mx-auto max-w-3xl px-4 text-center">
        <RevealSection>
          <TiltCard intensity={8}>
            <GlassCard className="p-8 sm:p-10" glow>
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                whileInView={{ scale: 1, opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5 }}
              >
                <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Ready to send something securely?</h2>
                <p className="mx-auto mt-4 max-w-md text-sm text-muted-foreground/60">
                  No account required. No plaintext on the server. Just a secret, a policy, and a link.
                </p>
                <MagneticButton strength={0.2}>
                  <Link href="/#create" className="btn-glow mt-8 inline-flex items-center gap-2.5 rounded-2xl bg-primary px-10 py-4 text-sm font-semibold text-primary-foreground shadow-xl shadow-primary/25 transition-all hover:shadow-2xl hover:shadow-primary/35 hover:scale-[1.02] active:scale-[0.98]">
                    <Send className="h-4 w-4" /> Create a delivery
                  </Link>
                </MagneticButton>
              </motion.div>
            </GlassCard>
          </TiltCard>
        </RevealSection>
      </section>
    </main>
  );
}
