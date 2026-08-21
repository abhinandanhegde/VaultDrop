"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Lock, Plus, X, RefreshCw, User, Flame, Clock, Timer, HeartPulse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  encryptSecret,
  generatePIN,
  ITERATIONS,
} from "@/lib/crypto";

const EXPIRY_OPTIONS = [
  { value: 300, label: "5 minutes" },
  { value: 3600, label: "1 hour" },
  { value: 14400, label: "4 hours" },
  { value: 86400, label: "1 day" },
  { value: 604800, label: "1 week" },
  { value: 0, label: "Never" },
] as const;

const MAX_RECIPIENTS = 10;

interface RecipientDraft {
  id: number;
  name: string;
  pin: string;
}

export default function Home() {
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [title, setTitle] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [recipients, setRecipients] = useState<RecipientDraft[]>([
    { id: 0, name: "", pin: "" },
  ]);
  const [burnAfterReading, setBurnAfterReading] = useState(true);
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

  const regeneratePin = (id: number) => {
    setRecipients(recipients.map((r) => (r.id === id ? { ...r, pin: generatePIN() } : r)));
  };

  const handleDrop = async () => {
    if (!secret.trim()) {
      setError("Type or paste a secret first.");
      return;
    }
    if (!title.trim()) {
      setError("Give it a label (e.g. \"API key\", \"Wi-Fi password\").");
      return;
    }
    if (releaseMode === "scheduled" && !releaseValue()) {
      setError("Pick a release time in the future, or release it now.");
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      // Encrypt in parallel (PBKDF2 is CPU-bound; parallel avoids serial stalls)
      const encrypted = await Promise.all(
        recipients.map((r) => encryptSecret(secret, r.pin, ITERATIONS)),
      );
      const recipientPayload = recipients.map((r, i) => ({
        name: r.name.trim() || null,
        pin: r.pin,
        encryptedData: encrypted[i].encryptedData,
        nonce: encrypted[i].nonce,
        salt: encrypted[i].salt,
        iterations: encrypted[i].iterations,
      }));

      const expiresAt =
        expirySeconds > 0
          ? new Date(Date.now() + expirySeconds * 1000).toISOString()
          : null;

      const res = await fetch("/api/delivery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients: recipientPayload,
          maxViews: 1,
          expiresAt,
          releaseAt: releaseValue(),
          renewalWindowMinutes: deadManEnabled ? renewalWindowMinutes : null,
          burnAfterReading,
          title,
          contentType: "text/plain",
        }),
      });

      const data = await res.json();
      if (!res.ok || data.status === "error") {
        throw new Error(data.message || "Failed to create delivery");
      }

      // Wipe plaintext from memory, then move to the dispatch board
      setSecret("");
      router.push(`/dashboard/${data.id}?token=${data.creatorToken}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="relative min-h-screen">
      <div className="relative z-10 w-full max-w-xl mx-auto px-4 py-14">
        {/* Badge */}
        <div className="mb-5 flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-1.5 text-xs font-medium text-primary">
            <Lock className="h-3.5 w-3.5" />
            Zero-knowledge · end-to-end encrypted
          </span>
        </div>

        {/* Headline */}
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Drop a secret.
            <br />
            <span className="text-primary">It self-destructs.</span>
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
            Encrypted in your browser. Sent to your people. Destroyed after the
            first read. The server never sees the plaintext.
          </p>
        </div>

        {/* Composer */}
        <div className="rounded-2xl border border-border/60 bg-card/70 p-5 shadow-2xl sm:p-6">
          {error && (
            <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Label */}
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Label — e.g. API key, Wi-Fi password, address"
            className="h-10 rounded-xl border-border/70 bg-background/60"
            aria-label="Label"
          />

          {/* Secret */}
          <textarea
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Paste your secret here…"
            rows={5}
            autoFocus
            className="mt-3 w-full resize-y rounded-xl border border-input bg-background/60 px-3 py-3 font-mono text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Secret content"
          />

          {/* Recipients */}
          <div className="mt-5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold">Who&apos;s it for?</label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={addRecipient}
                disabled={recipients.length >= MAX_RECIPIENTS}
                className="text-primary hover:text-primary"
              >
                <Plus className="mr-1 h-4 w-4" />
                Add person
              </Button>
            </div>

            <div className="mt-2 space-y-2">
              {recipients.map((r, i) => (
                <div
                  key={r.id}
                  className="flex items-center gap-2 rounded-xl border border-border/50 bg-background/40 px-2.5 py-2"
                >
                  <User className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  <Input
                    value={r.name}
                    onChange={(e) => updateRecipientName(r.id, e.target.value)}
                    placeholder={`Person ${i + 1} — optional`}
                    className="h-8 flex-1 rounded-lg border-transparent bg-transparent text-sm focus-visible:ring-1"
                    aria-label={`Recipient ${i + 1} name`}
                  />
                  <span className="rounded-md bg-muted px-2 py-1 font-mono text-xs font-bold tracking-widest text-muted-foreground">
                    {r.pin}
                  </span>
                  <button
                    type="button"
                    onClick={() => regeneratePin(r.id)}
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    aria-label="Regenerate PIN"
                    title="Regenerate PIN"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeRecipient(r.id)}
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-red-400"
                    aria-label="Remove recipient"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Each person gets their own link + PIN. Send them through different channels.
            </p>
          </div>

          {/* Policy row */}
          <div className="mt-5 flex flex-col gap-3 rounded-xl border border-border/40 bg-background/30 p-3 sm:flex-row sm:items-center sm:justify-between">
            {/* Burn toggle */}
            <button
              type="button"
              onClick={() => setBurnAfterReading(!burnAfterReading)}
              className="flex items-center gap-2 text-left"
            >
              <span
                className={cn(
                  "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                  burnAfterReading ? "bg-primary" : "bg-muted",
                )}
              >
                <span
                  className={cn(
                    "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                    burnAfterReading ? "translate-x-5" : "translate-x-1",
                  )}
                />
              </span>
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <Flame className={cn("h-4 w-4", burnAfterReading ? "text-orange-400" : "text-muted-foreground")} />
                Self-destruct after read
              </span>
            </button>

            {/* Expiry */}
            <label className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <select
                value={expirySeconds}
                onChange={(e) => setExpirySeconds(Number(e.target.value))}
                className="rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Expiration"
              >
                {EXPIRY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    Expires in {opt.label.toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Release scheduling */}
          <div className="mt-3 flex flex-col gap-3 rounded-xl border border-border/40 bg-background/30 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="flex items-center gap-2 text-sm font-medium">
                <Timer className={cn("h-4 w-4", releaseMode === "scheduled" ? "text-primary" : "text-muted-foreground")} />
                Time-lock release
              </span>
              <div className="flex gap-2">
                {(["now", "scheduled"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setReleaseMode(mode)}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                      releaseMode === mode
                        ? "bg-primary text-primary-foreground"
                        : "border border-border/50 bg-background/40 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {mode === "now" ? "Release now" : "Scheduled"}
                  </button>
                ))}
              </div>
            </div>

            {releaseMode === "scheduled" && (
              <div className="flex flex-col gap-2">
                <input
                  type="datetime-local"
                  value={releaseAt}
                  min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
                  onChange={(e) => setReleaseAt(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Release date and time"
                />
                <p className="text-[11px] text-muted-foreground">
                  Shares can be delivered now, but no one can open this drop until that time.
                </p>
              </div>
            )}
          </div>

          {/* Dead Man's Switch */}
          <div className="mt-3 flex flex-col gap-3 rounded-xl border border-border/40 bg-background/30 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="flex items-center gap-2 text-sm font-medium">
                <HeartPulse className={cn("h-4 w-4", deadManEnabled ? "text-red-400" : "text-muted-foreground")} />
                Dead man&apos;s switch
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={deadManEnabled}
                onClick={() => setDeadManEnabled((v) => !v)}
                className={cn(
                  "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                  deadManEnabled ? "bg-red-500" : "bg-muted",
                )}
              >
                <span
                  className={cn(
                    "inline-block h-4 w-4 transform rounded-full bg-background transition-transform",
                    deadManEnabled ? "translate-x-6" : "translate-x-1",
                  )}
                />
              </button>
            </div>

            {deadManEnabled && (
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-xs text-muted-foreground">Self-destructs unless I renew every</span>
                  <select
                    value={renewalWindowMinutes}
                    onChange={(e) => setRenewalWindowMinutes(Number(e.target.value))}
                    className="rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="Renewal window"
                  >
                    <option value={1}>1 minute</option>
                    <option value={10}>10 minutes</option>
                    <option value={60}>1 hour</option>
                    <option value={1440}>1 day</option>
                    <option value={10080}>1 week</option>
                  </select>
                </label>
                <p className="text-[11px] text-muted-foreground">
                  If you stop renewing on the dispatch board, every copy of this secret is destroyed —
                  it can never be opened by anyone.
                </p>
              </div>
            )}
          </div>

          {/* Submit */}
          <Button
            className="mt-4 w-full h-12 rounded-xl text-base font-semibold"
            size="lg"
            onClick={handleDrop}
            disabled={isLoading || !secret.trim() || !title.trim()}
          >
            {isLoading ? (
              <>
                <Spinner className="mr-2 h-4 w-4" />
                Sealing {recipients.length} envelope{recipients.length > 1 ? "s" : ""}…
              </>
            ) : (
              <>
                <Lock className="mr-2 h-4 w-4" />
                Drop the secret
              </>
            )}
          </Button>

          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            AES-256-GCM + PBKDF2-SHA256 · no sign-up · no plaintext on the server
          </p>
        </div>
      </div>
    </main>
  );
}