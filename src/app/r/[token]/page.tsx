"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Eye, EyeOff, AlertTriangle, Clock, Timer, HeartPulse, FileText, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { CopyButton } from "@/components/copy-button";
import Envelope from "@/components/envelope";
import PinInput from "@/components/pin-input";
import {
  decryptSecret,
  hashPinForTransport,
  unwrapFileKeyWithPin,
  decryptBytesWithRawKey,
  base64UrlDecode,
} from "@/lib/crypto";

type PageState = "loading" | "pin" | "opening" | "viewing" | "error" | "expired" | "revoked" | "locked" | "opened" | "not_released" | "deadman";

interface RecipientMeta {
  id: string;
  name?: string | null;
  title?: string | null;
  state: string;
  expiresAt?: string | null;
  releaseAt?: string | null;
  burnAfterReading: boolean;
  pinScheme?: "raw" | "sha256";
  kind?: "text" | "file";
  fileName?: string | null;
  fileMime?: string | null;
  fileSize?: number | null;
}

interface DecryptedFile {
  url: string;
  name: string;
  mime: string;
  size: number;
}

export default function EnvelopePage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;

  const [state, setState] = useState<PageState>("loading");
  const [meta, setMeta] = useState<RecipientMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [pinAttempt, setPinAttempt] = useState(0);
  const [content, setContent] = useState("");
  const [file, setFile] = useState<DecryptedFile | null>(null);
  const [show, setShow] = useState(false);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    return () => {
      if (file) URL.revokeObjectURL(file.url);
    };
  }, [file]);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/recipients/${token}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || data.status === "error") {
          setError(data.message || "This link is not valid");
          setState("error");
          return;
        }
        const d = data.data;
        setMeta({
          id: d.id,
          name: d.name,
          title: d.title,
          state: d.state,
          expiresAt: d.expiresAt,
          releaseAt: d.releaseAt,
          burnAfterReading: d.burnAfterReading,
          pinScheme: d.pinScheme === "sha256" ? "sha256" : "raw",
          kind: d.kind === "file" ? "file" : "text",
          fileName: d.fileName,
          fileMime: d.fileMime,
          fileSize: d.fileSize,
        });
        if (d.state === "expired") setState("expired");
        else if (d.state === "revoked") setState("revoked");
        else if (d.state === "locked") setState("locked");
        else if (d.state === "not_released") setState("not_released");
        else if (d.state === "deadman") setState("deadman");
        else if (d.state === "opened" || d.state === "destroyed") setState("opened");
        else setState("pin");
      })
      .catch(() => {
        setError("Failed to load this drop");
        setState("error");
      });
  }, [token]);

  async function handlePin(pin: string) {
    if (!token) return;
    setState("opening");
    setError(null);

    try {
      // Transport-hash the PIN for hashed-scheme drops so the raw PIN never
      // reaches the server. Decryption below still uses the raw PIN locally.
      const transportPin =
        meta?.pinScheme === "sha256" ? await hashPinForTransport(pin) : pin;
      const res = await fetch(`/api/recipients/${token}/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: transportPin }),
      });

      // Encrypted-file drops answer with raw ciphertext + metadata headers.
      const responseMime = res.headers.get("content-type") ?? "";
      if (res.ok && responseMime.includes("application/octet-stream")) {
        const metaB64 = res.headers.get("X-Vaultdrop-Meta");
        if (!metaB64) throw new Error("Malformed file delivery response");
        const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(metaB64)));
        const cipherBytes = new Uint8Array(await res.arrayBuffer());

        // Recover the content key locally, then decrypt — all in-browser.
        const fileKey = await unwrapFileKeyWithPin(
          header.wrapped.e,
          header.wrapped.n,
          header.wrapped.s,
          header.wrapped.it,
          pin,
        );
        const plain = await decryptBytesWithRawKey(cipherBytes, fileKey, header.iv);

        const blob = new Blob([plain as unknown as BlobPart], { type: header.mime });
        setFile({
          url: URL.createObjectURL(blob),
          name: header.fileName,
          mime: header.mime,
          size: header.size ?? plain.byteLength,
        });
        setContent("");
        setOpened(Boolean(header.destroyed));
        setState("viewing");
        return;
      }

      const data = await res.json();

      if (!res.ok || data.status === "error") {
        if (data.remainingAttempts !== undefined) setRemaining(data.remainingAttempts);
        if (res.status === 423 && data.releaseAt) {
          setMeta((m) => (m ? { ...m, releaseAt: data.releaseAt } : m));
          setState("not_released");
        } else if (res.status === 423) {
          setState("locked");
        } else if (res.status === 410 && data.message?.includes("renewing")) {
          setState("deadman");
        } else {
          setError(data.message || "That PIN didn't match");
          setState("pin");
          setPinAttempt((n) => n + 1);
        }
        return;
      }

      const decrypted = await decryptSecret(
        data.data.encryptedData,
        data.data.nonce,
        data.data.salt,
        data.data.iterations,
        pin,
      );
      setContent(decrypted);
      setOpened(Boolean(data.destroyed));
      setState("viewing");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to decrypt");
      setState("error");
    }
  }

  function formatBytes(bytes: number | null | undefined): string {
    if (!bytes || bytes <= 0) return "—";
    const units = ["B", "KB", "MB", "GB"];
    let v = bytes;
    let u = 0;
    while (v >= 1024 && u < units.length - 1) {
      v /= 1024;
      u++;
    }
    return `${v % 1 === 0 ? v : v.toFixed(1)} ${units[u]}`;
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

  function formatCountdown(target: string) {
    const diff = new Date(target).getTime() - Date.now();
    if (diff <= 0) return "now";
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
    return `${mins}m ${secs}s`;
  }

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state !== "not_released" || !meta?.releaseAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state, meta?.releaseAt]);

  const isReleased = Boolean(meta?.releaseAt && new Date(meta.releaseAt).getTime() <= now);

  useEffect(() => {
    if (state === "not_released" && isReleased) setState("pin");
  }, [state, isReleased]);

  const label = meta?.name || meta?.title || "A secret";

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-12">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-[360px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Loading */}
        {state === "loading" && (
          <div className="flex flex-col items-center gap-6 animate-fade-in">
            <Envelope size="lg" className="animate-glow" />
            <Spinner className="h-5 w-5 text-primary" />
          </div>
        )}

        {/* Sealed envelope + PIN */}
        {state === "pin" && (
          <div className="flex flex-col items-center gap-6 animate-pop-in">
            <Envelope size="lg" label={label} className="animate-glow" />

            <div className="w-full rounded-2xl border border-border/60 bg-card/70 p-6 backdrop-blur">
              <div className="mb-1 text-center">
                <h1 className="text-lg font-bold">A sealed drop is waiting</h1>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {meta?.name ? `For ${meta.name} — ` : ""}enter the 6-digit PIN sent
                  to you separately.
                </p>
              </div>

              <div className="mt-5">
                <PinInput
                  onSubmit={handlePin}
                  autoFocus
                  resetKey={pinAttempt}
                />
              </div>

              {(error || remaining !== null) && (
                <div className="mt-4">
                  {error && (
                    <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5 text-sm text-red-400">
                      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}
                  {remaining !== null && remaining > 0 && (
                    <p className="mt-2 text-center text-xs text-muted-foreground">
                      {remaining} attempt{remaining === 1 ? "" : "s"} left before lockout.
                    </p>
                  )}
                </div>
              )}

              <div className="mt-4 flex items-center justify-center gap-4 text-[11px] text-muted-foreground">
                {meta?.kind === "file" && (
                  <span className="flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    File · {meta.fileSize ? formatBytes(meta.fileSize) : "size hidden"}
                  </span>
                )}
                {meta?.expiresAt && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Expires {formatDate(meta.expiresAt)}
                  </span>
                )}
                {meta?.burnAfterReading && <span>Burns after this read</span>}
              </div>
            </div>
          </div>
        )}

        {/* Opening */}
        {state === "opening" && (
          <div className="flex flex-col items-center gap-6 animate-fade-in">
            <Envelope size="lg" label={label} open />
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4 text-primary" />
              Breaking the seal…
            </div>
          </div>
        )}

        {/* Revealed — file */}
        {state === "viewing" && file && (
          <div className="animate-pop-in">
            <div className="mb-4 flex flex-col items-center gap-3">
              <Envelope size="md" open />
              <div className="text-center">
                <p className="text-xs uppercase tracking-widest text-green-400">
                  Seal broken
                </p>
                <h1 className="text-lg font-bold">{meta?.title || "Your secret"}</h1>
              </div>
            </div>

            <div className="rounded-2xl border border-border/60 bg-card/70 p-5 backdrop-blur">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-border/50 bg-muted/40">
                  <FileText className="h-6 w-6 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(file.size)} · decrypted in your browser
                  </p>
                </div>
              </div>

              <a
                href={file.url}
                download={file.name}
                className="mt-5"
                aria-label="Download File"
              >
                <Button className="w-full h-11 rounded-xl font-semibold">
                  <Download className="mr-2 h-4 w-4" />
                  Download File
                </Button>
              </a>

              {opened && (
                <p className="mt-3 text-center text-[11px] text-muted-foreground">
                  The encrypted copy on the server has been deleted. This local
                  copy is yours to keep or remove.
                </p>
              )}
            </div>

            {opened && (
              <div className="mt-4 rounded-xl border border-orange-500/20 bg-orange-500/5 px-4 py-3 text-center text-sm">
                <strong className="text-orange-400">This drop has been destroyed.</strong>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Nothing remains on the server. It can never be opened again.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Revealed — text */}
        {state === "viewing" && !file && (
          <div className="animate-pop-in">
            <div className="mb-4 flex flex-col items-center gap-3">
              <Envelope size="md" open />
              <div className="text-center">
                <p className="text-xs uppercase tracking-widest text-green-400">
                  Seal broken
                </p>
                <h1 className="text-lg font-bold">{meta?.title || "Your secret"}</h1>
              </div>
            </div>

            <div className="relative rounded-2xl border border-border/60 bg-card/70 p-5 backdrop-blur">
              <pre
                className={`max-h-[50vh] overflow-auto whitespace-pre-wrap font-mono text-sm leading-relaxed transition-all duration-300 ${
                  show ? "" : "blur-sm select-none"
                }`}
              >
                {content}
              </pre>
              <button
                onClick={() => setShow(!show)}
                className="absolute right-3 top-3 rounded-lg border border-border/50 bg-background/80 p-1.5 hover:bg-accent"
                aria-label={show ? "Hide" : "Show"}
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            <div className="mt-3 flex items-center justify-center gap-2">
              <CopyButton text={content} label="Copy secret" />
              <Button variant="ghost" size="sm" onClick={() => setShow(!show)}>
                {show ? "Hide" : "Show"}
              </Button>
            </div>

            {opened && (
              <div className="mt-4 rounded-xl border border-orange-500/20 bg-orange-500/5 px-4 py-3 text-center text-sm">
                <strong className="text-orange-400">This drop has been destroyed.</strong>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Nothing remains on the server. It can never be opened again.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Time-locked */}
        {state === "not_released" && !isReleased && (
          <div className="flex flex-col items-center gap-6 animate-pop-in">
            <Envelope size="lg" label={label} className="animate-glow" />
            <Card className="w-full border-border/60 bg-card/70 backdrop-blur">
              <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border/50 bg-muted/40">
                  <Timer className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-lg font-bold">Time-locked</h2>
                  <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                    This drop is sealed until{" "}
                    <strong className="text-foreground">
                      {meta?.releaseAt ? formatDate(meta.releaseAt) : "later"}
                    </strong>
                    . Even with the right PIN, no one can open it before then.
                  </p>
                </div>
                {meta?.releaseAt && (
                  <div className="rounded-xl border border-primary/30 bg-primary/10 px-5 py-2 font-mono text-xl font-bold text-primary">
                    {formatCountdown(meta.releaseAt)}
                  </div>
                )}
                {meta?.expiresAt && (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    Expires {formatDate(meta.expiresAt)}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Time-lock released → prompt for PIN */}
        {state === "not_released" && isReleased && (
          <div className="animate-pop-in">
            <Envelope size="lg" label={label} className="animate-glow" />
            <Spinner className="mt-4 h-5 w-5 text-primary" />
          </div>
        )}

        {/* Terminal states */}
        {state === "expired" && (
          <StatusCard icon={<Clock className="h-6 w-6 text-red-400" />} title="This drop expired" desc="It was never opened in time and is gone." />
        )}
        {state === "revoked" && (
          <StatusCard icon={<AlertTriangle className="h-6 w-6 text-red-400" />} title="This drop was revoked" desc="The sender recalled it before you opened it." />
        )}
        {state === "deadman" && (
          <StatusCard icon={<HeartPulse className="h-6 w-6 text-red-400" />} title="Self-destructed" desc="The sender stopped renewing this drop. It self-destructed — nothing remains on the server." />
        )}
        {state === "locked" && (
          <StatusCard icon={<AlertTriangle className="h-6 w-6 text-red-400" />} title="Locked and destroyed" desc="Too many wrong PINs. The copy was destroyed — nothing remains on the server." />
        )}
        {state === "opened" && (
          <StatusCard icon={<Envelope size="sm" />} title="Already opened" desc="This drop was opened before. It's gone forever." />
        )}
        {state === "error" && (
          <div className="animate-pop-in">
            <Envelope size="lg" />
            <StatusCard icon={<AlertTriangle className="h-6 w-6 text-red-400" />} title="Something went wrong" desc={error || "This link is not valid."} />
          </div>
        )}
      </div>
    </main>
  );
}

function StatusCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <Card className="border-border/60 bg-card/70 backdrop-blur animate-fade-in">
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border/50 bg-muted/40">
          {icon}
        </div>
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">{desc}</p>
        </div>
      </CardContent>
    </Card>
  );
}