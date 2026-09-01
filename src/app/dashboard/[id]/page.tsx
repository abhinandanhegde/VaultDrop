"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence, useInView } from "framer-motion";
import {
  Copy, Ban, Clock, RefreshCw, Eye, ShieldCheck, HeartPulse,
  Users, Flame, AlertTriangle, Timer, Plus, ArrowLeft, Shield,
  Activity, TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { CopyButton } from "@/components/copy-button";
import Envelope from "@/components/envelope";
import GlassCard from "@/components/glass-card";
import TiltCard from "@/components/tilt-card";
import SpotlightCard from "@/components/spotlight-card";
import MagneticButton from "@/components/magnetic-button";
import FloatingOrb from "@/components/floating-orb";
import GradientLine from "@/components/gradient-line";
import NumberCounter from "@/components/number-counter";
import { cn } from "@/lib/utils";

interface Recipient {
  id: string;
  name: string | null;
  urlToken: string;
  status: string;
  viewCount: number;
  failedAttempts: number;
  openedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

interface EventItem {
  id: string;
  eventType: string;
  eventTime: string;
  metadata?: Record<string, unknown> | null;
}

interface Delivery {
  title: string | null;
  status: string;
  expiresAt: string | null;
  releaseAt: string | null;
  renewalDeadline: string | null;
  renewalWindowMinutes: number | null;
  createdAt: string;
  burnAfterReading: boolean;
}

function formatDate(s: string | null | undefined) {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function timeAgo(s: string | null | undefined) {
  if (!s) return "";
  const diff = Date.now() - new Date(s).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function appOrigin() {
  return typeof window !== "undefined" ? window.location.origin : process.env.NEXT_PUBLIC_APP_URL || "";
}

const STATUS_STYLES: Record<string, string> = {
  pending: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  opened: "border-green-500/30 bg-green-500/10 text-green-400",
  revoked: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
  locked: "border-red-500/30 bg-red-500/10 text-red-400",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting",
  opened: "Opened",
  revoked: "Revoked",
  locked: "Locked",
};

const EVENT_ICONS: Record<string, { icon: React.ReactNode; color: string }> = {
  created: { icon: <Plus className="h-3 w-3" />, color: "bg-blue-500" },
  pin_validated: { icon: <Shield className="h-3 w-3" />, color: "bg-green-500" },
  pin_failed: { icon: <Ban className="h-3 w-3" />, color: "bg-red-500" },
  accessed: { icon: <Eye className="h-3 w-3" />, color: "bg-green-500" },
  renewed: { icon: <RefreshCw className="h-3 w-3" />, color: "bg-blue-500" },
  destroyed: { icon: <Flame className="h-3 w-3" />, color: "bg-orange-500" },
  revoked: { icon: <Ban className="h-3 w-3" />, color: "bg-yellow-500" },
  locked: { icon: <AlertTriangle className="h-3 w-3" />, color: "bg-red-500" },
  expired: { icon: <Clock className="h-3 w-3" />, color: "bg-red-400" },
};

export default function DispatchBoard() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = params?.id;
  const token = searchParams?.get("token");

  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  const fetchData = useCallback(async () => {
    if (!id || !token) return;
    setLoading(true);
    try {
      const [sRes, rRes, eRes] = await Promise.all([
        fetch(`/api/delivery/${id}/status?token=${token}`),
        fetch(`/api/delivery/${id}/recipients?token=${token}`),
        fetch(`/api/delivery/${id}/events?token=${token}`),
      ]);
      const s = await sRes.json();
      if (!sRes.ok || s.status === "error") throw new Error(s.message || "Failed to load");
      setDelivery({ title: s.data.title, status: s.data.status, expiresAt: s.data.expiresAt, releaseAt: s.data.releaseAt, renewalDeadline: s.data.renewalDeadline, renewalWindowMinutes: s.data.renewalWindowMinutes, createdAt: s.data.createdAt, burnAfterReading: s.data.burnAfterReading });
      const r = await rRes.json();
      if (rRes.ok && r.status === "ok") setRecipients(r.data.recipients || []);
      const e = await eRes.json();
      if (eRes.ok && e.status === "ok") setEvents(e.data || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load dispatch");
    } finally {
      setLoading(false);
    }
  }, [id, token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function renewDelivery() {
    setActionKey("renew");
    try {
      const res = await fetch(`/api/delivery/${id}/renew`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creatorToken: token }) });
      const d = await res.json();
      if (!res.ok || d.status === "error") alert(d.message || "Failed to renew");
      else fetchData();
    } catch { alert("Failed to renew"); } finally { setActionKey(null); }
  }

  async function revokeRecipient(rec: Recipient) {
    if (!confirm(`Revoke ${rec.name || "this recipient"}'s link?`)) return;
    setActionKey(`rev-${rec.urlToken}`);
    try {
      const res = await fetch(`/api/recipients/${rec.urlToken}/revoke`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creatorToken: token }) });
      const d = await res.json();
      if (!res.ok || d.status === "error") alert(d.message || "Failed to revoke");
      else fetchData();
    } catch { alert("Failed to revoke"); } finally { setActionKey(null); }
  }

  async function copyAll() {
    const lines = recipients.map((r, i) => `${r.name || `Person ${i + 1}`}\nLink: ${appOrigin()}/r/${r.urlToken}\nPIN: (sent separately)`);
    try { await navigator.clipboard.writeText(lines.join("\n\n")); setCopiedAll(true); setTimeout(() => setCopiedAll(false), 2000); } catch { /* */ }
  }

  if (!id || !token) {
    return (
      <main id="main-content" className="flex min-h-screen items-center justify-center p-4">
        <GlassCard className="max-w-sm text-center"><h1 className="text-lg font-bold">Dispatch board requires a link</h1><p className="mt-2 text-sm text-muted-foreground">Open the full dashboard URL from your create screen.</p></GlassCard>
      </main>
    );
  }

  if (loading) {
    return (
      <main id="main-content" className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-5">
          <div className="relative">
            <Spinner className="h-8 w-8 text-primary" />
            <div className="absolute inset-0 animate-glow rounded-full" />
          </div>
          <p className="text-sm text-muted-foreground animate-pulse-glow">Loading dispatch…</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main id="main-content" className="flex min-h-screen items-center justify-center p-4">
        <GlassCard className="max-w-sm border-red-500/30 text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-red-400" />
          <h1 className="text-lg font-bold text-red-400">{error}</h1>
          <MagneticButton strength={0.2}>
            <Button variant="outline" size="sm" className="mt-4 rounded-xl" onClick={fetchData}>Retry</Button>
          </MagneticButton>
        </GlassCard>
      </main>
    );
  }

  const openedCount = recipients.filter((r) => r.status === "opened").length;
  const waiting = recipients.filter((r) => r.status === "pending").length;
  const revokedCount = recipients.filter((r) => r.status === "revoked").length;

  const statusColor = delivery?.status === "active" ? "text-green-400 bg-green-500/10 border-green-500/30" : delivery?.status === "expired" ? "text-red-400 bg-red-500/10 border-red-500/30" : "text-muted-foreground bg-muted border-border/50";

  return (
    <main id="main-content" className="relative min-h-screen pb-20 overflow-hidden">
      {/* Background orbs */}
      <FloatingOrb className="top-20 right-[10%]" size={300} color="hsl(var(--primary))" delay={0} />
      <FloatingOrb className="bottom-40 left-[5%]" size={250} color="hsl(270 80% 60%)" delay={7} />

      <div className="mx-auto w-full max-w-5xl px-4 pt-8 sm:px-6 lg:px-8">
        {/* Back button */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
        >
          <button onClick={() => router.push("/")} className="mb-6 flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Create another drop
          </button>
        </motion.div>

        {/* 2-column desktop layout */}
        <div className="grid gap-8 lg:grid-cols-12">
          {/* Left: Header + Stats */}
          <div className="lg:col-span-4">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            >
              <GlassCard className="sticky top-24">
                <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-primary/60">Dispatch board</p>
                <h1 className="mt-2 text-2xl font-bold tracking-tight lg:text-3xl">{delivery?.title || "Untitled"}</h1>
                <div className="mt-3">
                  <motion.span
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium", statusColor)}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", delivery?.status === "active" ? "bg-green-400 animate-pulse" : "bg-current")} />
                    {delivery?.status === "active" ? "Active" : delivery?.status}
                  </motion.span>
                </div>

                {/* Bento Stats */}
                <div className="mt-6 grid grid-cols-2 gap-2">
                  <SpotlightCard className="rounded-xl border border-border/15 bg-card/20 p-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground"><Eye className="h-3.5 w-3.5 text-green-400" /> Opened</div>
                    <div className="mt-1 text-2xl font-bold tabular-nums text-green-400">
                      <NumberCounter value={openedCount} />
                    </div>
                  </SpotlightCard>
                  <SpotlightCard className="rounded-xl border border-border/15 bg-card/20 p-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5 text-blue-400" /> Waiting</div>
                    <div className="mt-1 text-2xl font-bold tabular-nums text-blue-400">
                      <NumberCounter value={waiting} />
                    </div>
                  </SpotlightCard>
                  <SpotlightCard className="rounded-xl border border-border/15 bg-card/20 p-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" /> Total</div>
                    <div className="mt-1 text-2xl font-bold tabular-nums">
                      <NumberCounter value={recipients.length} />
                    </div>
                  </SpotlightCard>
                  {revokedCount > 0 && (
                    <SpotlightCard className="rounded-xl border border-border/15 bg-card/20 p-3">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Ban className="h-3.5 w-3.5 text-yellow-400" /> Revoked</div>
                      <div className="mt-1 text-2xl font-bold tabular-nums text-yellow-400">
                        <NumberCounter value={revokedCount} />
                      </div>
                    </SpotlightCard>
                  )}
                </div>

                <GradientLine className="my-4" />

                {/* Expiry/release info */}
                <div className="space-y-2 text-xs text-muted-foreground/60">
                  {delivery?.expiresAt && <p className="flex items-center gap-1.5"><Clock className="h-3 w-3 text-orange-400" /> Expires {formatDate(delivery.expiresAt)}</p>}
                  {delivery?.releaseAt && <p className="flex items-center gap-1.5"><Timer className="h-3 w-3 text-primary" /> Unlocks {formatDate(delivery.releaseAt)}</p>}
                  {delivery?.burnAfterReading && <p className="flex items-center gap-1.5"><Flame className="h-3 w-3 text-orange-400" /> Burn after reading</p>}
                </div>

                {/* Dead Man's Switch */}
                {delivery?.renewalDeadline && delivery.status === "active" && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="mt-4 rounded-xl border border-red-500/20 bg-red-500/[0.04] p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-sm font-medium"><HeartPulse className="h-4 w-4 text-red-400 animate-pulse-glow" /> Dead man&apos;s armed</span>
                      <MagneticButton strength={0.3}>
                        <Button size="sm" variant="outline" onClick={renewDelivery} disabled={actionKey !== null} className="rounded-xl border-red-500/30 text-red-400 hover:bg-red-500/10">
                          <RefreshCw className={cn("mr-1 h-3 w-3", actionKey === "renew" && "animate-spin")} /> Renew
                        </Button>
                      </MagneticButton>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground/60">Deadline: <span className="font-semibold text-red-400">{formatDate(delivery.renewalDeadline)}</span></p>
                  </motion.div>
                )}

                {/* Bulk actions */}
                <div className="mt-4 flex gap-2">
                  {recipients.length > 1 && (
                    <MagneticButton strength={0.2} className="flex-1">
                      <Button variant="outline" size="sm" onClick={copyAll} className="w-full rounded-xl">
                        <Copy className="mr-1 h-3.5 w-3.5" />{copiedAll ? "Copied!" : "Copy all"}
                      </Button>
                    </MagneticButton>
                  )}
                  <MagneticButton strength={0.3}>
                    <Button variant="outline" size="sm" onClick={fetchData} className="rounded-xl"><RefreshCw className="h-3.5 w-3.5" /></Button>
                  </MagneticButton>
                </div>
              </GlassCard>
            </motion.div>
          </div>

          {/* Right: Recipients + Timeline */}
          <div className="space-y-6 lg:col-span-8">
            {/* Recipients */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
            >
              <h2 className="mb-4 text-sm font-semibold text-foreground/80">Recipients</h2>
              <div className="space-y-2.5">
                {recipients.length === 0 && <GlassCard className="py-10 text-center text-sm text-muted-foreground">No recipients yet.</GlassCard>}
                <AnimatePresence>
                  {recipients.map((r, i) => {
                    const url = `${appOrigin()}/r/${r.urlToken}`;
                    const opened = r.status === "opened";
                    const revoked = r.status === "revoked";
                    const borderColor = opened ? "border-l-green-500" : revoked ? "border-l-yellow-500" : "border-l-blue-500";
                    return (
                      <motion.div
                        key={r.id}
                        layout
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ duration: 0.4, delay: i * 0.05 }}
                        className={cn("glass-strong rounded-2xl border-l-[3px] p-4 transition-all duration-300 hover:shadow-lg hover:shadow-primary/[0.03]", borderColor, revoked && "opacity-60")}
                      >
                        <div className="flex items-center gap-3.5">
                          <Envelope size="sm" open={opened} label={r.name || `Person ${i + 1}`} className={cn(!opened && !revoked && "animate-glow")} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-semibold">{r.name || `Person ${i + 1}`}</p>
                              <Badge className={cn("text-[10px] font-semibold rounded-lg", STATUS_STYLES[r.status] || "")}>{STATUS_LABEL[r.status] || r.status}</Badge>
                            </div>
                            <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/60">{url}</p>
                            {opened && r.openedAt && <p className="mt-0.5 text-[11px] text-green-400">Opened {timeAgo(r.openedAt)}</p>}
                            {revoked && r.revokedAt && <p className="mt-0.5 text-[11px] text-yellow-400">Revoked {timeAgo(r.revokedAt)}</p>}
                            {r.status === "pending" && <p className="mt-0.5 text-[11px] text-muted-foreground/50">Send link + PIN through separate channels.</p>}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <CopyButton text={url} label="Link" compact />
                            <MagneticButton strength={0.3}>
                              <Button variant="ghost" size="sm" onClick={() => revokeRecipient(r)} disabled={actionKey === `rev-${r.urlToken}` || opened || revoked} className="h-8 w-8 rounded-xl p-0 text-red-400/50 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-30">
                                {actionKey === `rev-${r.urlToken}` ? <Spinner className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                              </Button>
                            </MagneticButton>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </motion.div>

            {/* Activity Timeline */}
            {events.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
              >
                <GlassCard>
                  <h2 className="mb-5 flex items-center gap-2 text-sm font-semibold">
                    <Activity className="h-4 w-4 text-primary" /> Activity
                  </h2>
                  <div className="relative ml-2 space-y-0">
                    <div className="absolute left-[7px] top-2 bottom-2 w-px bg-gradient-to-b from-primary/30 via-border/30 to-border/10" aria-hidden="true" />
                    {events.slice().reverse().map((e, i) => {
                      const evt = EVENT_ICONS[e.eventType] || EVENT_ICONS.created;
                      const label = !["created", "pin_validated", "pin_failed", "accessed", "destroyed", "renewed", "revoked", "locked", "expired"].includes(e.eventType) ? e.eventType : null;
                      const eventLabel = e.eventType === "created" ? "Drop dispatched" : e.eventType === "pin_validated" ? "PIN accepted" : e.eventType === "pin_failed" ? "Failed PIN attempt" : e.eventType === "accessed" ? "Secret opened" : e.eventType === "renewed" ? "Dead man's renewed" : e.eventType === "destroyed" ? (e.metadata?.reason === "dead_man_switch" ? "Self-destructed" : "Destroyed after read") : e.eventType === "revoked" ? "Link revoked" : e.eventType === "locked" ? "Locked — wrong PINs" : e.eventType === "expired" ? "Drop expired" : label || e.eventType;
                      return (
                        <motion.div
                          key={e.id}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.05 }}
                          className="relative flex items-start gap-3 py-2.5"
                        >
                          <div className={cn("relative z-10 flex h-[15px] w-[15px] flex-shrink-0 items-center justify-center rounded-full text-white", evt.color)}>{evt.icon}</div>
                          <div className="min-w-0 flex-1 pt-px">
                            <p className="text-sm text-foreground/90">{eventLabel}</p>
                            <p className="text-[11px] text-muted-foreground/50">{timeAgo(e.eventTime)}</p>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </GlassCard>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
