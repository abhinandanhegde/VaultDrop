"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { Lock, AlertTriangle, Clock, Eye, EyeOff, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { CopyButton } from "@/components/copy-button";
import Envelope from "@/components/envelope";
import GlassCard from "@/components/glass-card";
import AnimatedSection from "@/components/animated-section";
import { cn } from "@/lib/utils";
import { decryptSecret, hashPinForTransport } from "@/lib/crypto";

type PageState = "loading" | "pin" | "decrypting" | "viewing" | "error" | "expired" | "revoked" | "locked" | "destroyed";

interface DeliveryMetadata {
  id: string;
  title?: string | null;
  contentType?: string;
  status: string;
  pinScheme?: "raw" | "sha256";
  maxViews: number;
  expiresAt?: string | null;
  createdAt: string;
  accessedAt?: string | null;
  destroyedAt?: string | null;
}

export default function AccessPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [state, setState] = useState<PageState>("loading");
  const [delivery, setDelivery] = useState<DeliveryMetadata | null>(null);
  const [pin, setPin] = useState(["", "", "", "", "", ""]);
  const [, setActivePinIndex] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [decryptedContent, setDecryptedContent] = useState<string>("");
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [destroyed, setDestroyed] = useState(false);

  useEffect(() => {
    if (!id) return;

    fetch(`/api/delivery/${id}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || data.status === "error") {
          handleError(data.message || "Delivery not found");
          return;
        }
        const d = data.data;
        setDelivery(d);
        if (d.status === "expired") {
          setState("expired");
        } else if (d.status === "revoked") {
          setState("revoked");
        } else if (d.status === "locked") {
          setState("locked");
        } else if (d.status === "destroyed" || d.status === "accessed") {
          setState("destroyed");
        } else {
          setState("pin");
        }
      })
      .catch(() => handleError("Failed to load delivery"));

    setPin(["", "", "", "", "", ""]);
  }, [id]);

  useEffect(() => {
    if (state === "pin" && inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, [state]);

  function handleError(message: string) {
    setError(message);
    setState("error");
  }

  function handlePinChange(index: number, value: string) {
    if (value.length > 1) return;
    if (!/^\d*$/.test(value)) return;

    const newPin = [...pin];
    newPin[index] = value;
    setPin(newPin);

    if (value && index < 5) {
      setActivePinIndex(index + 1);
      inputRefs.current[index + 1]?.focus();
    } else if (!value && index > 0) {
      const newActive = index - 1;
      setActivePinIndex(newActive);
      inputRefs.current[newActive]?.focus();
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !pin[index] && index > 0) {
      const newPin = [...pin];
      newPin[index - 1] = "";
      setPin(newPin);
      setActivePinIndex(index - 1);
      inputRefs.current[index - 1]?.focus();
    }
  }

  async function handlePinSubmit() {
    const enteredPin = pin.join("");
    if (enteredPin.length !== 6) return;

    if (!id) return;

    setState("decrypting");
    setError(null);

    try {
      const transportPin =
        delivery?.pinScheme === "sha256"
          ? await hashPinForTransport(enteredPin)
          : enteredPin;
      const res = await fetch(`/api/delivery/${id}/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: transportPin }),
      });

      const data = await res.json();

      if (!res.ok || data.status === "error") {
        if (data.remainingAttempts !== undefined) {
          setRemainingAttempts(data.remainingAttempts);
        }
        if (res.status === 423) {
          setState("locked");
        } else {
          setError(data.message || "Invalid PIN");
          setState("pin");
        }
        return;
      }

      const { encryptedData, nonce, salt, iterations } = data.data;

      const decrypted = await decryptSecret(encryptedData, nonce, salt, iterations, enteredPin);
      setDecryptedContent(decrypted);
      setDestroyed(data.destroyed || false);
      setState("viewing");
    } catch (err: unknown) {
      console.error("Decryption error:", err);
      setError("Failed to decrypt: " + (err instanceof Error ? err.message : "Unknown error"));
      setState("error");
    }
  }

  function handleClear() {
    setPin(["", "", "", "", "", ""]);
    setError(null);
    setRemainingAttempts(null);
    setState("pin");
    inputRefs.current[0]?.focus();
  }

  useEffect(() => {
    if (pin.every((d) => d !== "") && state === "pin") {
      handlePinSubmit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, state]);

  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    });
  }

  return (
    <main id="main-content" className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-12">
      {/* Background */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute left-1/2 top-1/2 h-[400px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/[0.06] blur-[140px]" />
      </div>

      <div className="relative z-10 w-full max-w-lg">
        {/* Loading */}
        {state === "loading" && (
          <div className="flex flex-col items-center gap-7 animate-fade-in">
            <div className="relative">
              <Envelope size="lg" className="animate-glow" />
              <div className="absolute inset-0 rounded-xl bg-primary/5 animate-pulse-glow" />
            </div>
            <div className="flex flex-col items-center gap-2">
              <Spinner className="h-5 w-5 text-primary" />
              <span className="text-sm text-muted-foreground/70">Loading…</span>
            </div>
          </div>
        )}

        {/* PIN entry */}
        {state === "pin" && (
          <div className="flex flex-col items-center gap-7 animate-pop-in">
            <Envelope size="lg" label={delivery?.title || "A secret"} className="animate-glow" />

            <GlassCard className="w-full p-6 sm:p-8 text-center" glow>
              <div className="mb-1 flex items-center justify-center gap-2">
                <Lock className="h-5 w-5 text-primary" />
                <h1 className="text-xl font-bold tracking-tight">Access the Secure Delivery</h1>
              </div>
              {delivery?.title && (
                <p className="mt-1 text-sm text-muted-foreground">
                  Label: <strong className="text-foreground/90">{delivery.title}</strong>
                </p>
              )}
              <p className="mt-1 text-sm text-muted-foreground">
                Enter the 6-digit access PIN you received separately.
              </p>

              {error && (
                <div className="mt-4 animate-shake flex items-start gap-2.5 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {remainingAttempts !== null && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {remainingAttempts} attempt{remainingAttempts === 1 ? "" : "s"} remaining before lockout.
                </p>
              )}

              <div className="mt-6 flex justify-center gap-2.5">
                {pin.map((digit, i) => (
                  <Input
                    key={i}
                    ref={(el) => { inputRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handlePinChange(i, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(i, e)}
                    onPaste={(e) => {
                      e.preventDefault();
                      const pasted = e.clipboardData.getData("text").trim();
                      if (/^\d{6}$/.test(pasted)) {
                        const newPin = pasted.split("");
                        setPin(newPin);
                        handlePinSubmit();
                      }
                    }}
                    className={cn(
                      "h-12 w-10 rounded-xl border text-center text-xl font-bold transition-all duration-150",
                      "bg-background outline-none",
                      digit
                        ? "border-primary/70 bg-primary/10 text-foreground"
                        : "border-input text-transparent caret-primary",
                      "focus:border-primary focus:shadow-[0_0_0_3px_hsl(var(--primary)/0.15)]",
                    )}
                    autoComplete="one-time-code"
                  />
                ))}
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="mt-4 rounded-lg text-muted-foreground"
                onClick={handleClear}
              >
                Clear and re-enter
              </Button>

              {delivery && (
                <div className="mt-5 flex flex-wrap items-center justify-center gap-4 text-[11px] text-muted-foreground/60">
                  {delivery.maxViews > 0 && (
                    <span className="flex items-center gap-1">
                      <Eye className="h-3 w-3" />
                      Max views: {delivery.maxViews}
                    </span>
                  )}
                  {delivery.expiresAt && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Expires {formatDate(delivery.expiresAt)}
                    </span>
                  )}
                </div>
              )}
            </GlassCard>
          </div>
        )}

        {/* Decrypting */}
        {state === "decrypting" && (
          <div className="flex flex-col items-center gap-7 animate-fade-in">
            <Envelope size="lg" label={delivery?.title || "A secret"} open />
            <div className="flex flex-col items-center gap-3">
              <div className="relative">
                <Spinner className="h-6 w-6 text-primary" />
                <div className="absolute inset-0 animate-glow rounded-full" />
              </div>
              <span className="text-sm font-medium text-muted-foreground">Verifying PIN and decrypting…</span>
              <span className="text-[11px] text-muted-foreground/50">Decrypting in your browser</span>
            </div>
          </div>
        )}

        {/* Viewing */}
        {state === "viewing" && (
          <div className="animate-pop-in">
            <div className="mb-5 flex flex-col items-center gap-4">
              <Envelope size="md" open />
              <div className="text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-green-400">
                  Seal broken
                </p>
                <h1 className="mt-1 text-xl font-bold">{delivery?.title || "Your secret"}</h1>
                {delivery?.accessedAt && (
                  <p className="mt-1 text-xs text-muted-foreground/60">
                    Accessed {formatDate(delivery.accessedAt)}
                  </p>
                )}
              </div>
            </div>

            <GlassCard className="relative p-5 sm:p-6" glow>
              <pre
                className={`max-h-[50vh] overflow-auto whitespace-pre-wrap font-mono text-sm leading-relaxed transition-all duration-500 ${
                  showSecret ? "" : "blur-sm select-none"
                }`}
              >
                {decryptedContent}
              </pre>
              <button
                onClick={() => setShowSecret(!showSecret)}
                className="absolute right-4 top-4 rounded-lg border border-border/50 bg-background/80 p-2 backdrop-blur-sm transition-colors hover:bg-accent"
                aria-label={showSecret ? "Hide" : "Show"}
              >
                {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </GlassCard>

            <div className="mt-3 flex items-center justify-center gap-3">
              <CopyButton text={decryptedContent} label="Copy secret" />
              <Button variant="ghost" size="sm" onClick={() => setShowSecret(!showSecret)} className="rounded-lg">
                {showSecret ? "Hide" : "Show"}
              </Button>
            </div>

            {destroyed && (
              <AnimatedSection delay={2} className="mt-4">
                <GlassCard className="border-green-500/20 bg-green-500/[0.04] p-4 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <Shield className="h-4 w-4 text-green-400" />
                    <strong className="text-sm text-green-400">This was a one-time delivery.</strong>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground/60">
                    The secret has been destroyed and is no longer available on the server.
                  </p>
                </GlassCard>
              </AnimatedSection>
            )}
          </div>
        )}

        {/* Error */}
        {state === "error" && (
          <div className="animate-pop-in flex flex-col items-center gap-6">
            <Envelope size="lg" />
            <GlassCard className="w-full border-red-500/30 text-center">
              <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-2xl bg-red-500/10 mb-4">
                <AlertTriangle className="h-6 w-6 text-red-400" />
              </div>
              <h2 className="text-lg font-bold text-red-400">{error || "Something went wrong"}</h2>
              <Button onClick={handleClear} className="mt-4 w-full rounded-xl">
                Try again
              </Button>
            </GlassCard>
          </div>
        )}

        {/* Terminal states */}
        {state === "expired" && (
          <StatusCard
            icon={<Clock className="h-6 w-6 text-red-400" />}
            title="Delivery expired"
            desc="This secret has expired and is no longer available."
          />
        )}
        {state === "revoked" && (
          <StatusCard
            icon={<Lock className="h-6 w-6 text-red-400" />}
            title="Delivery revoked"
            desc="The creator has revoked this delivery."
          />
        )}
        {state === "locked" && (
          <StatusCard
            icon={<Lock className="h-6 w-6 text-red-400" />}
            title="Locked and destroyed"
            desc="Too many wrong PINs. The copy was destroyed — nothing remains on the server."
          />
        )}
        {state === "destroyed" && (
          <StatusCard
            icon={<Lock className="h-6 w-6 text-muted-foreground" />}
            title="Secret no longer available"
            desc="This secret has already been delivered and destroyed."
          />
        )}
      </div>
    </main>
  );
}

function StatusCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="animate-pop-in">
      <GlassCard className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/30 backdrop-blur-sm">
          {icon}
        </div>
        <h2 className="text-lg font-bold tracking-tight">{title}</h2>
        <p className="mt-2 max-w-xs mx-auto text-sm leading-relaxed text-muted-foreground">{desc}</p>
      </GlassCard>
    </div>
  );
}
