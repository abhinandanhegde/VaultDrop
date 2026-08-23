"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Lock, Plus, X, RefreshCw, User, Flame, Clock, Timer, HeartPulse, Eye, FileText, Paperclip, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
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
  { value: 300, label: "5 minutes" },
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
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v % 1 === 0 ? v : v.toFixed(1)} ${units[u]}`;
}

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
  const [sendMode, setSendMode] = useState<"secret" | "file">("secret");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [recipients, setRecipients] = useState<RecipientDraft[]>([
    { id: 0, name: "", pin: "" },
  ]);
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

  const handleDrop = async () => {
    if (sendMode === "secret" && !secret.trim()) {
      setError("Type or paste a secret first.");
      return;
    }
    if (sendMode === "file" && !selectedFile) {
      setError("Choose a file first.");
      return;
    }
    // Reject oversized files BEFORE any encryption or upload work.
    if (sendMode === "file" && selectedFile && selectedFile.size > MAX_FILE_BYTES) {
      setError(`That file is ${formatBytes(selectedFile.size)} — the limit is ${formatBytes(MAX_FILE_BYTES)}.`);
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
      const expiresAt =
        expirySeconds > 0
          ? new Date(Date.now() + expirySeconds * 1000).toISOString()
          : null;

      let response: Response;

      if (sendMode === "secret") {
        // Encrypt in parallel (PBKDF2 is CPU-bound; parallel avoids serial stalls)
        const encrypted = await Promise.all(
          recipients.map((r) => encryptSecret(secret, r.pin, ITERATIONS)),
        );
        // Hash PINs for transport so the raw PIN never leaves the browser.
        const recipientPayload = await Promise.all(
          recipients.map(async (r, i) => ({
            name: r.name.trim() || null,
            pin: await hashPinForTransport(r.pin),
            encryptedData: encrypted[i].encryptedData,
            nonce: encrypted[i].nonce,
            salt: encrypted[i].salt,
            iterations: encrypted[i].iterations,
          })),
        );

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
        // File mode: encrypt locally with a random content key, wrap that key
        // for each recipient PIN. Only ciphertext ever leaves this browser.
        const dek = generateFileKey();
        const plainBytes = new Uint8Array(await selectedFile!.arrayBuffer());
        const { ciphertext, nonceB64 } = await encryptBytesWithRawKey(plainBytes, dek);

        const wrappedList = await Promise.all(
          recipients.map((r) => wrapFileKeyForRecipient(dek, r.pin)),
        );
        dek.fill(0); // best-effort scrub of the local key material

        const recipientPayload = await Promise.all(
          recipients.map(async (r, i) => ({
            name: r.name.trim() || null,
            pin: await hashPinForTransport(r.pin),
            wrapped: wrappedList[i],
          })),
        );

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

        response = await fetch("/api/delivery/file", {
          method: "POST",
          body: form,
        });
      }

      const data = await response.json();
      if (!response.ok || data.status === "error") {
        throw new Error(data.message || "Failed to create delivery");
      }

      // Wipe plaintext from memory, then move to the dispatch board
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

  return (
    <main className="relative min-h-screen">
      <div className="relative z-10 w-full max-w-xl mx-auto px-4 py-14">
        {/* Badge */}
        <div className="mb-5 flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-1.5 text-xs font-medium text-primary">
            <Lock className="h-3.5 w-3.5" />
            Encrypted in your browser — the server never sees plaintext
          </span>
        </div>

        {/* Headline */}
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Read it once.
            <br />
            <span className="text-primary">Gone forever.</span>
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
            Encrypted in your browser before it ever leaves your device. The
            server holds only ciphertext it can&apos;t open. One-time links and
            PINs, sent separately — then every copy deletes itself.
          </p>
        </div>

        {/* Composer */}
        <div className="rounded-2xl border border-border/60 bg-card/70 p-5 shadow-2xl sm:p-6">
          {error && (
            <div role="alert" className="mb-4 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* What are you sending? */}
          <div className="mb-4">
            <p className="mb-2 text-sm font-semibold">What are you sending?</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Delivery type">
              <button
                type="button"
                role="radio"
                aria-checked={sendMode === "secret"}
                onClick={() => setSendMode("secret")}
                className={cn(
                  "flex items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                  sendMode === "secret"
                    ? "border-primary/60 bg-primary/5"
                    : "border-border/60 bg-background/40 hover:border-border",
                )}
              >
                <span className="text-lg leading-none mt-0.5">🔐</span>
                <span>
                  <span className="block text-sm font-semibold">Send a Secret</span>
                  <span className="block text-xs text-muted-foreground">
                    Text, passwords, credentials, notes
                  </span>
                </span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={sendMode === "file"}
                onClick={() => setSendMode("file")}
                className={cn(
                  "flex items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                  sendMode === "file"
                    ? "border-primary/60 bg-primary/5"
                    : "border-border/60 bg-background/40 hover:border-border",
                )}
              >
                <span className="text-lg leading-none mt-0.5">📎</span>
                <span>
                  <span className="block text-sm font-semibold">Send a Secure File</span>
                  <span className="block text-xs text-muted-foreground">
                    PDFs, images, documents, and more
                  </span>
                </span>
              </button>
            </div>
          </div>

          {/* Label */}
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Label — e.g. API key, Wi-Fi password, address"
            className="h-10 rounded-xl border-border/70 bg-background/60"
            aria-label="Label"
          />

          {/* Secret */}
          {sendMode === "secret" ? (
            <textarea
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Paste your secret here…"
              rows={5}
              autoFocus
              className="mt-3 w-full resize-y rounded-xl border border-input bg-background/60 px-3 py-3 font-mono text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Secret content"
            />
          ) : selectedFile ? (
            /* Selected file card */
            <div
              className={cn(
                "mt-3 flex flex-col gap-3 rounded-xl border border-dashed border-primary/50 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between",
              )}
            >
              <div className="flex min-w-0 items-center gap-3">
                <FileText className="h-8 w-8 flex-shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{selectedFile.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatBytes(selectedFile.size)} · {selectedFile.type || "unknown type"}
                  </p>
                </div>
              </div>
              <div className="flex flex-shrink-0 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Replace
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  aria-label="Remove file"
                  onClick={() => {
                    setSelectedFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                >
                  Remove
                </Button>
              </div>
            </div>
          ) : (
            /* Drop zone */
            <label
              htmlFor="vaultdrop-file-input"
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const f = e.dataTransfer.files?.[0];
                if (f) setSelectedFile(f);
              }}
              className={cn(
                "mt-3 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-background/40 px-4 py-10 text-center transition-colors",
                dragging ? "border-primary/70 bg-primary/10" : "border-border/70 hover:border-primary/40",
              )}
            >
              <UploadCloud className="h-8 w-8 text-muted-foreground" />
              <span className="text-sm font-medium">
                Drop your file here, or <span className="text-primary underline underline-offset-2">browse</span>
              </span>
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Paperclip className="h-3 w-3" />
                Encrypted in your browser before upload · Max {formatBytes(MAX_FILE_BYTES)} · PDF, PNG/JPG, DOC(X), TXT, ZIP…
              </span>
            </label>
          )}

          {/* Hidden file input — always mounted so Replace's ref stays live */}
          <input
            ref={fileInputRef}
            id="vaultdrop-file-input"
            type="file"
            className="sr-only"
            aria-label="Choose file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setSelectedFile(f);
              e.target.value = "";
            }}
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

          {/* Policy */}
          <div className="mt-5 flex flex-col gap-3 rounded-xl border border-border/40 bg-background/30 p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {/* Auto-delete toggle */}
              <button
                type="button"
                role="switch"
                aria-checked={burnAfterReading}
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
                  Auto-delete after first open
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

            {/* Open limit — only shown when the drop survives its first open */}
            {!burnAfterReading && (
              <div className="flex flex-col gap-1.5 border-t border-border/40 pt-3">
                <label className="flex flex-wrap items-center gap-2 text-sm">
                  <Eye className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">Delete after</span>
                  <span className="inline-flex items-center overflow-hidden rounded-lg border border-input bg-background">
                    <button
                      type="button"
                      onClick={() => setMaxViews((v) => Math.max(1, v - 1))}
                      disabled={maxViews <= 1}
                      className="px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="Fewer opens"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={99}
                      value={maxViews}
                      onChange={(e) => setMaxViews(clampMaxViews(e.target.value))}
                      onBlur={(e) => setMaxViews(clampMaxViews(e.target.value))}
                      className="w-10 border-0 bg-transparent py-1.5 text-center text-sm tabular-nums [appearance:textfield] focus-visible:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      aria-label="Number of opens before deletion"
                    />
                    <button
                      type="button"
                      onClick={() => setMaxViews((v) => Math.min(99, v + 1))}
                      disabled={maxViews >= 99}
                      className="px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="More opens"
                    >
                      +
                    </button>
                  </span>
                  <span className="font-medium">opens</span>
                </label>
                <p className="pl-6 text-[11px] text-muted-foreground">
                  Every open counts, even the same person opening twice. After the{" "}
                  {maxViews === 1 ? "first" : maxViews === 2 ? "second" : maxViews === 3 ? "third" : `${maxViews}th`}{" "}
                  open, every copy is deleted for good.
                </p>
              </div>
            )}
          </div>

          {/* Scheduled opening */}
          <div className="mt-3 flex flex-col gap-3 rounded-xl border border-border/40 bg-background/30 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="flex items-center gap-2 text-sm font-medium">
                <Timer className={cn("h-4 w-4", releaseMode === "scheduled" ? "text-primary" : "text-muted-foreground")} />
                Scheduled opening
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
                    {mode === "now" ? "Openable right away" : "At a set time"}
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
                  Share the link whenever you like — nobody can open it before this time.
                </p>
              </div>
            )}
          </div>

          {/* Delete if I go silent */}
          <div className="mt-3 flex flex-col gap-3 rounded-xl border border-border/40 bg-background/30 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="flex items-center gap-2 text-sm font-medium">
                <HeartPulse className={cn("h-4 w-4", deadManEnabled ? "text-red-400" : "text-muted-foreground")} />
                Delete if I stop checking in
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
                  <span className="text-xs text-muted-foreground">Self-destructs unless I press &ldquo;Renew&rdquo; at least every</span>
                  <select
                    value={renewalWindowMinutes}
                    onChange={(e) => setRenewalWindowMinutes(Number(e.target.value))}
                    className="rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="Check-in interval"
                  >
                    <option value={1}>1 minute</option>
                    <option value={10}>10 minutes</option>
                    <option value={60}>1 hour</option>
                    <option value={1440}>1 day</option>
                    <option value={10080}>1 week</option>
                  </select>
                </label>
                <p className="text-[11px] text-muted-foreground">
                  If you miss a check-in on the dashboard, every copy of this secret is deleted — nobody can open it, ever.
                </p>
              </div>
            )}
          </div>

          {/* Submit */}
          <Button
            className="mt-4 w-full h-12 rounded-xl text-base font-semibold"
            size="lg"
            onClick={handleDrop}
            aria-busy={isLoading}
            disabled={
              isLoading ||
              !title.trim() ||
              (sendMode === "secret" ? !secret.trim() : !selectedFile)
            }
          >
            {isLoading ? (
              <>
                <Spinner className="mr-2 h-4 w-4" />
                {sendMode === "file"
                  ? "Encrypting & uploading…"
                  : `Sealing ${recipients.length} envelope${recipients.length > 1 ? "s" : ""}…`}
              </>
            ) : sendMode === "file" ? (
              <>
                <Lock className="mr-2 h-4 w-4" />
                Create Secure Delivery
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