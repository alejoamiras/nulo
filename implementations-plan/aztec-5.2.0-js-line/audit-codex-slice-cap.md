# Codex audit — second-order consequences of the account-state slice cap raise

Fresh `xhigh` session, read-only, run after the 32 → 64 MiB cap raise landed. Asked one
question: what are the second-order consequences of doubling `maxSliceCodeUnits`?

**Verdict (codex):** "64 MiB unblocks the measured backup, but it is poorly calibrated … I would
use 40 MiB for the one-constant fix."

## Findings, verified against the code

### 1. 64 MiB makes the cap non-binding — CONFIRMED

`apps/extension/src/utils/full-backup-helpers.ts:21` — `MAX_BACKUP_FILE_BYTES = 64 * 1024 * 1024`.

The slice cap was set equal to the whole-file cap. The slice is a strict subset of the file, and
this JSON is effectively ASCII (1 UTF-16 code unit ≈ 1 byte), so the file cap always trips first
and the slice cap stops functioning as a bound. Codex adds the encrypted case: base64 inflates
4/3, so a 64 MiB sealed file carries ≤48 MiB of plaintext — anything ≥48 MiB is non-binding for
encrypted backups too.

**A sub-component's cap must sit meaningfully below its container's cap or it is decoration.**

### 2. The export warning was neutralized — CONFIRMED

`apps/extension/src/wallet/services/account-state/service.ts:224` derives the threshold as
`ACCOUNT_STATE_CAPS.maxSliceCodeUnits * 0.8`. Doubling the cap moved it 26.8M → 53.7M. Today's
payload is 33.8M, i.e. 50% of the new cap — so it no longer warns.

This is the sharpest finding: the same edit that unblocked import silently disabled the early
signal that had been added *during the diagnosis of that very failure*. Codex's framing is worth
keeping: it "removes the main signal that canonical duplication is growing and makes deferral
easier to normalize organizationally."

**A derived threshold silently follows the constant it derives from.** Any cap change must state
what happens to everything computed off it.

### 3. The timeout-mismatch hypothesis was WRONG — corrected by codex

The pre-audit hypothesis was that the raise shifts the failure mode from clean early rejection to
late partial failure, because `IMPORT_REGISTRATION_BUDGET_MS` (30s) did not move with the cap.

Codex checked the actual path: the oversize result was produced *after* `finalizeRestore`, so the
old behavior ALSO left the profile imported with account-state missing, behind the same
errors/Continue gate. It was never a clean rejection, so there is no such regression. A
deadline-driven partial is in fact better for recovery (some PXE registrations survive) and worse
only for atomicity and diagnosis (success becomes slice-order-dependent).

### 4. Minor factual correction

PXE persistence is encrypted SQLite-OPFS (`packages/aztec-runtime/src/pxe/opfs-store.ts`), not
IndexedDB (legacy cleanup code). Consequence is unchanged — persistent quota/disk, never
`chrome.storage.local`.

## Recommendation

**40 MiB (41,943,040 code units)** — still a one-constant change:

| | 64 MiB (landed) | 40 MiB (recommended) |
|---|---|---|
| Today's 33.8M payload | 50% of cap | 80.6% of cap |
| Export warning fires today | no (threshold 53.7M) | yes (threshold 33.55M) |
| Binding vs 64 MiB file cap | no | yes |
| Binding vs ~48 MiB encrypted-plaintext ceiling | no | yes |
| Headroom | 33.3M | 8.1M ≈ 1.8× the 4.5MB event that broke it |

40 MiB restores the warning at today's payload, keeps the cap below both ceilings, and accepts
thinner headroom in exchange for a live signal — the correct trade, since the failure being
fixed was caused by a thin margin with NO signal.

The constant warning at today's payload is accurate rather than noisy: the slice genuinely sits
at 81% of a real ceiling with ~35% of it duplicated canonical artifacts.

## Still open (unchanged by cap calibration)

- The pre-cap `JSON.stringify(raw)` in `normalizeAccountStateSlice` allocates a full serialized
  copy BEFORE the cap check, so an unbounded hostile payload is measured before it is rejected.
  Codex notes child caps are likewise applied only after iterating and accumulating every child.
  Neither is affected by the cap's value; both predate this arc.
- The real fix remains slice-shrinking (dedupe or omit re-registerable canonical contracts),
  deferred pending handshake/auth-registry tracking research — see D12 in `plan.md`.
