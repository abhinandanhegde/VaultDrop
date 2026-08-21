# VaultDrop — 6-Minute Demo Script

**Hook:** "You're the CTO of a company that keeps leaking secrets through chat. Here's how you'd fix it in 5 minutes."

## Act 1 — The Problem (0:00–0:45)

"PrivateBin solves one problem: *securely paste a secret*. But real secret-sharing is a **workflow**:
send it, verify the right person opened it, prove it was destroyed."

> Demo talking points:
> - "I'm going to drop an API key."
> - "Watch what PrivateBin can't do — track, control, and destroy after delivery."

## Act 2 — The Drop (0:45–2:00)

1. Type a secret in the composer (a fake AWS key or `postgres://` connection string).
2. Point out the **policy panel**:
   - Self-destruct after read (on)
   - Expires in 1 hour
   - **Time-lock**: "Release now" → toggle to "Scheduled", pick a time a few minutes out
   - **Dead man's switch**: toggle it on, pick "1 minute"
3. Click **Drop the secret** — "It's sealed in the browser before it ever leaves your machine."

## Act 3 — Multi-Recipient Delivery (2:00–2:45)

1. On the dispatch board: "I can send this to 5 different people, and each gets their *own* link and PIN."
2. Copy a link + reveal the PIN from Details.
3. Open the recipient link in another window, enter the PIN → secret decrypts in the browser.
4. "Notice: the board now shows **Opened** with a timestamp — and the copy was destroyed after read."

## Act 4 — The Kill Switch (2:45–3:45)

1. Back on the board, open another recipient's Details.
2. Click **Revoke** — "Instant. Their copy is destroyed before they ever open it."
3. "Now the one nobody else has: **the dead man's switch.**"

## Act 5 — The Dead Man's Switch (3:45–5:00)

1. "This drop has a 1-minute renewal window. I have to click **Renew** before the clock runs out."
2. Click **Renew** — watch the deadline push forward.
3. "But what if I go silent? What if I'm compromised, or just stop caring?"
4. **Don't renew.** Let the deadline pass (1 minute for demo; explain it'd be days in production).
5. Refresh the board → the drop shows **Self-destructed — sender stopped renewing**.
6. Open the recipient link → "This secret is gone. Ciphertext wiped from the server. Not even the database has it."

## Act 6 — The Proof (5:00–6:00)

Show the **Activity timeline**:
- Drop dispatched
- PIN accepted / Failed PIN attempts
- Self-destructed — sender stopped renewing

"Every action is timestamped. Every destruction is provable. That's the difference between a paste bin and a secret delivery agent."

## Fallbacks

- **If a link breaks:** navigate straight to the dashboard URL (it has the creator token).
- **If the deadline hasn't passed:** renew, then set a shorter window on a fresh drop.
- **Demo accounts:** none needed — no sign-up, that's part of the pitch.