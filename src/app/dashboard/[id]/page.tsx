"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { Copy, Ban, Clock, RefreshCw, Eye, ShieldCheck, HeartPulse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { CopyButton } from "@/components/copy-button";
import Envelope from "@/components/envelope";
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
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function appOrigin() {
  return typeof window !== "undefined"
    ? window.location.origin
    : process.env.NEXT_PUBLIC_APP_URL || "";
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
      setDelivery({
        title: s.data.title,
        status: s.data.status,
        expiresAt: s.data.expiresAt,
        releaseAt: s.data.releaseAt,
        renewalDeadline: s.data.renewalDeadline,
        renewalWindowMinutes: s.data.renewalWindowMinutes,
        createdAt: s.data.createdAt,
        burnAfterReading: s.data.burnAfterReading,
      });
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

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function renewDelivery() {
    setActionKey("renew");
    try {
      const res = await fetch(`/api/delivery/${id}/renew`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creatorToken: token }),
      });
      const d = await res.json();
      if (!res.ok || d.status === "error") alert(d.message || "Failed to renew");
      else fetchData();
    } catch {
      alert("Failed to renew");
    } finally {
      setActionKey(null);
    }
  }

  async function revokeRecipient(rec: Recipient) {
    if (!confirm(`Revoke ${rec.name || "this recipient"}'s link? Their copy will be destroyed.`)) return;
    setActionKey(`rev-${rec.urlToken}`);
    try {
      const res = await fetch(`/api/recipients/${rec.urlToken}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creatorToken: token }),
      });
      const d = await res.json();
      if (!res.ok || d.status === "error") alert(d.message || "Failed to revoke");
      else fetchData();
    } catch {
      alert("Failed to revoke");
    } finally {
      setActionKey(null);
    }
  }

  async function copyAll() {
    const lines = recipients.map((r, i) => {
      const url = `${appOrigin()}/r/${r.urlToken}`;
      return `${r.name || `Person ${i + 1}`}\nLink: ${url}\nPIN: from the "Details" popup`;
    });
    try {
      await navigator.clipboard.writeText(lines.join("\n\n"));
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }

  if (!id || !token) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <Card className="max-w-sm">
          <CardContent className="py-8 text-center">
            <h1 className="text-lg font-bold">Dispatch board requires a link</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Open the full dashboard URL from your create screen.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8 text-primary" />
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <Card className="max-w-sm border-red-500/30">
          <CardContent className="py-8 text-center">
            <h1 className="text-lg font-bold text-red-400">⚠️ {error}</h1>
          </CardContent>
        </Card>
      </main>
    );
  }

  const openedCount = recipients.filter((r) => r.status === "opened").length;
  const waiting = recipients.filter((r) => r.status === "pending").length;

  return (
    <main className="relative flex min-h-screen flex-col items-center overflow-hidden pb-16">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 left-1/2 h-[360px] w-[680px] -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-2xl px-4 pt-10">
        {/* Header */}
        <div className="mb-6 text-center animate-rise">
          <p className="text-xs uppercase tracking-[0.25em] text-primary">Dispatch board</p>
          <h1 className="mt-1 text-3xl font-bold">{delivery?.title || "Untitled drop"}</h1>
          <div className="mt-3 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Eye className="h-3.5 w-3.5 text-green-400" />
              <strong className="text-foreground">{openedCount}</strong> opened
            </span>
            <span>·</span>
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5 text-blue-400" />
              <strong className="text-foreground">{waiting}</strong> waiting
            </span>
            {delivery?.expiresAt && (
              <>
                <span>·</span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5 text-orange-400" />
                  expires {formatDate(delivery.expiresAt)}
                </span>
              </>
            )}
            {delivery?.releaseAt && (
              <>
                <span>·</span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5 text-primary" />
                  unlocks {formatDate(delivery.releaseAt)}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Dead Man's Switch banner */}
        {delivery?.renewalDeadline && delivery.status === "active" && (
          <div className="mb-5 flex flex-col gap-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3 animate-fade-in">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="flex items-center gap-2 text-sm font-medium">
                <HeartPulse className="h-4 w-4 text-red-400" />
                Dead man&apos;s switch is armed
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={renewDelivery}
                disabled={actionKey !== null}
              >
                <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", actionKey === "renew" && "animate-spin")} />
                Renew
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              This drop self-destructs unless you renew every{" "}
              {delivery.renewalWindowMinutes && delivery.renewalWindowMinutes >= 60
                ? `${Math.round(delivery.renewalWindowMinutes / 60)} hour${delivery.renewalWindowMinutes >= 120 ? "s" : ""}`
                : `${delivery.renewalWindowMinutes ?? "?"} minute${(delivery.renewalWindowMinutes ?? 1) === 1 ? "" : "s"}`}
              {" "}· next deadline{" "}
              <span className="font-semibold text-red-400">{formatDate(delivery.renewalDeadline)}</span>
            </p>
          </div>
        )}

        {/* Recipients */}
        <div className="space-y-3">
          {recipients.length === 0 && (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No recipients yet.
              </CardContent>
            </Card>
          )}

          {recipients.map((r, i) => {
            const url = `${appOrigin()}/r/${r.urlToken}`;
            const opened = r.status === "opened";
            const revoked = r.status === "revoked";
            return (
              <Card
                key={r.id}
                className={cn(
                  "animate-pop-in transition-all",
                  revoked && "opacity-60",
                )}
              >
                <CardContent className="flex items-center gap-4 p-4">
                  <Envelope
                    size="sm"
                    open={opened}
                    label={r.name || `Person ${i + 1}`}
                    className={cn(!opened && !revoked && "animate-glow")}
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-semibold">
                        {r.name || `Person ${i + 1}`}
                      </p>
                      <Badge className={cn("text-xs", STATUS_STYLES[r.status] || "")}>
                        {STATUS_LABEL[r.status] || r.status}
                      </Badge>
                    </div>
                    <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                      {url}
                    </p>
                    {r.status === "opened" && r.openedAt && (
                      <p className="mt-0.5 text-xs text-green-400">
                        Opened {formatDate(r.openedAt)}
                      </p>
                    )}
                    {r.status === "revoked" && r.revokedAt && (
                      <p className="mt-0.5 text-xs text-yellow-400">
                        Revoked {formatDate(r.revokedAt)}
                      </p>
                    )}
                    {r.status === "pending" && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Link + PIN below — send through separate channels.
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <CopyButton text={url} label="Link" compact />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => revokeRecipient(r)}
                        disabled={actionKey === `rev-${r.urlToken}` || opened || revoked}
                        className="text-red-400 hover:text-red-300 disabled:opacity-40"
                      >
                        {actionKey === `rev-${r.urlToken}` ? (
                          <Spinner className="h-3.5 w-3.5" />
                        ) : (
                          <Ban className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Bulk + refresh */}
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {recipients.length} link{recipients.length === 1 ? "" : "s"} dispatched
          </p>
          <div className="flex items-center gap-2">
            {recipients.length > 1 && (
              <Button variant="outline" size="sm" onClick={copyAll}>
                <Copy className="mr-1.5 h-3.5 w-3.5" />
                {copiedAll ? "Copied!" : "Copy all"}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={fetchData}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Activity */}
        {events.length > 0 && (
          <Card className="mt-8">
            <CardContent className="p-5">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Activity
              </h2>
              <div className="space-y-2.5">
                {events.slice().reverse().map((e) => (
                  <div key={e.id} className="flex items-start gap-3 text-sm">
                    <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary/60" />
                    <div className="min-w-0">
                      <p className="text-foreground">
                        {e.eventType === "created" && "Drop dispatched"}
                        {e.eventType === "pin_validated" && "PIN accepted"}
                        {e.eventType === "pin_failed" && "Failed PIN attempt"}
                        {e.eventType === "accessed" && "Secret opened"}
                        {e.eventType === "renewed" && "Dead man's switch renewed"}
                        {e.eventType === "destroyed" && (e.metadata?.reason === "dead_man_switch" ? "Self-destructed — sender stopped renewing" : "Copy destroyed after read")}
                        {e.eventType === "revoked" && "Link revoked"}
                        {e.eventType === "locked" && "Locked — copy destroyed (wrong PINs)"}
                        {e.eventType === "expired" && "Drop expired"}
                        {!["created", "pin_validated", "pin_failed", "accessed", "destroyed", "renewed", "revoked", "locked", "expired"].includes(e.eventType) &&
                          e.eventType}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(e.eventTime)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="mt-8 text-center">
          <Button variant="ghost" size="sm" onClick={() => router.push("/")}>
            Drop another secret
          </Button>
        </div>
      </div>
    </main>
  );
}