"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { Lock, Unlock, AlertTriangle, Clock, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { CopyButton } from "@/components/copy-button";
import { decryptSecret } from "@/lib/crypto";

type PageState = "loading" | "pin" | "decrypting" | "viewing" | "error" | "expired" | "revoked" | "locked" | "destroyed";

interface DeliveryMetadata {
  id: string;
  title?: string | null;
  contentType?: string;
  status: string;
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

  // Fetch delivery metadata on mount
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
        }
      })
      .catch(() => handleError("Failed to load delivery"));

    // Clear all inputs on mount
    setPin(["", "", "", "", "", ""]);
  }, [id]);

  // Focus PIN input on mount
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
    if (value.length > 1) return; // prevent pasting multiple chars
    if (!/^\d*$/.test(value)) return; // only digits

    const newPin = [...pin];
    newPin[index] = value;
    setPin(newPin);

    if (value && index < 5) {
      setActivePinIndex(index + 1);
      inputRefs.current[index + 1]?.focus();
    } else if (!value && index > 0) {
      // Move to previous on delete
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
      const res = await fetch(`/api/delivery/${id}/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: enteredPin }),
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

      // Decrypt the secret in the browser
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

  // Auto-submit when all 6 digits are entered
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

  // Render helpers
  const renderPINState = () => (
    <Card className="max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="h-5 w-5 text-primary" />
          Access the Secure Delivery
        </CardTitle>
        {delivery?.title && (
          <CardDescription>
            Label: <strong>{delivery.title}</strong>
          </CardDescription>
        )}
        <CardDescription>
          Enter the 6-digit access PIN you received separately.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-md bg-red-500/5 border border-red-500/20 p-3 text-sm text-red-400 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {remainingAttempts !== null && (
          <p className="text-xs text-muted-foreground">
            {remainingAttempts} attempt(s) remaining before lockout.
          </p>
        )}

        <div className="flex justify-center gap-2">
          {pin.map((digit, i) => (
            <Input
              key={i}
              ref={(el) => {
                inputRefs.current[i] = el;
              }}
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
              className="w-12 h-12 text-center text-2xl font-bold"
              autoComplete="one-time-code"
            />
          ))}
        </div>

        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={handleClear}
        >
          Clear and re-enter
        </Button>

        {delivery && (
          <div className="flex justify-between text-xs text-muted-foreground">
            {delivery.maxViews > 0 && (
              <span>
                <Clock className="inline h-3 w-3 mr-1" />
                Max views: {delivery.maxViews}
              </span>
            )}
            {delivery.expiresAt && (
              <span>
                Expires: {formatDate(delivery.expiresAt)}
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );

  const renderDecrypting = () => (
    <Card className="max-w-md mx-auto">
      <CardContent className="flex flex-col items-center justify-center py-10 space-y-4">
        <Spinner className="h-8 w-8 text-primary" />
        <p className="text-center text-sm text-muted-foreground">
          Verifying PIN and decrypting your secret…
        </p>
      </CardContent>
    </Card>
  );

  const renderViewing = () => (
    <Card className="max-w-2xl mx-auto border-green-500/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-green-400">
          <Unlock className="h-5 w-5" />
          Secret Delivered
        </CardTitle>
        <CardDescription>
          {delivery?.title && `Label: ${delivery.title}`}
          {delivery?.accessedAt && ` • Accessed at ${formatDate(delivery.accessedAt)}`}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="relative">
          <pre
            className={`whitespace-pre-wrap rounded-md bg-muted p-4 text-sm font-mono overflow-x-auto transition-all ${
              showSecret ? "blur-none" : "blur-sm select-none"
            }`}
          >
            {decryptedContent}
          </pre>
          <button
            onClick={() => setShowSecret(!showSecret)}
            className="absolute top-2 right-2 rounded-md bg-background/80 p-1 hover:bg-accent"
          >
            {showSecret ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>

        <div className="flex items-center justify-between">
          <CopyButton text={decryptedContent} label="Copy secret" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSecret(!showSecret)}
          >
            {showSecret ? "Hide" : "Show"} Secret
          </Button>
        </div>

        {destroyed && (
          <div className="rounded-md bg-green-500/5 border border-green-500/20 p-3 text-sm">
            <strong className="text-green-400">✅ This was a one-time delivery.</strong>
            <p className="text-muted-foreground mt-1">
              The secret has been destroyed and is no longer available on the server.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );

  const renderError = () => (
    <Card className="max-w-md mx-auto border-red-500/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-red-400">
          <AlertTriangle className="h-5 w-5" />
          {error || "Something went wrong"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Button onClick={handleClear} className="w-full">
          Try again
        </Button>
      </CardContent>
    </Card>
  );

  const renderStatusState = (s: PageState, icon: React.ReactNode, title: string, desc: string) => (
    <Card className="max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        <CardDescription>{desc}</CardDescription>
      </CardHeader>
    </Card>
  );

  return (
    <main className="flex min-h-screen flex-col items-center py-16 bg-gradient-to-b from-background to-card/20">
      <div className="w-full max-w-2xl px-4">
        {state === "loading" && renderDecrypting()}
        {state === "pin" && renderPINState()}
        {state === "decrypting" && renderDecrypting()}
        {state === "viewing" && renderViewing()}
        {state === "error" && renderError()}
        {state === "expired" &&
          renderStatusState("expired", <Clock className="h-5 w-5 text-red-400" />, "Delivery expired", "This secret has expired and is no longer available.")}
        {state === "revoked" &&
          renderStatusState("revoked", <Lock className="h-5 w-5 text-red-400" />, "Delivery revoked", "The creator has revoked this delivery.")}
        {state === "locked" &&
          renderStatusState("locked", <Lock className="h-5 w-5 text-red-400" />, "Locked and destroyed", "Too many wrong PINs. The copy was destroyed — nothing remains on the server.")}
        {state === "destroyed" &&
          renderStatusState("destroyed", <Lock className="h-5 w-5 text-muted-foreground" />, "Secret no longer available", "This secret has already been delivered and destroyed.")}
      </div>
    </main>
  );
}
