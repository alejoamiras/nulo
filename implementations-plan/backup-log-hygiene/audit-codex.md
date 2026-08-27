# Audit — codex (gpt-5.6-sol, xhigh, read-only)

Verdict: *"Reject as written; keep the targeted remediation, but make retention minimization Arc 0
and fix the recon gaps before execution."*

Session `01a0445c-66f5-7791-b460-7e0db39dfce6`.

Converges with the Claude audit on every structural point — the `trim()`-placement bug (C6), the
`base-client.ts` key-material leak (C3), the missed client sinks (C3), and that brands cannot work
at runtime (C7). Independent additions below.

## Findings adopted

| # | Finding | Action |
|---|---|---|
| **C1** | **THREAT-MODEL CORRECTION: `chrome.storage.session` is memory-backed, cleared on browser restart / extension update / reload. It is NOT written to disk.** | Rewrite the severity framing in `recon.md` and `plan.md`. The CSV export (real disk) and cross-SW-restart retention within a browsing session remain real; "2000 entries on disk" was wrong. |
| **C2** | **Two more Tier-0 sites.** `execution/helpers/batched-view-simulation.ts:380,411,424` log raw simulation/utility `values` at **Error**, including private-return paths — same class as `view-executor.ts:127`. And `wallet-core/src/storage/entity_storage.ts:85` logs the first 200 chars of ANY malformed stored row at **Error** — contact, network, transaction, profile, or attacker-supplied content, and outside arc 5's lint scope (different package). | Add both to arc 3. |
| **C4** | **Debug triage is *partially* sound.** Confirmed NOT retroactive, and startup defaults to Info, so there is no config-load race. BUT `console-sniffer.ts:2` shares ONE queue across every console method — pre-wiring `console.debug` arguments can replay through the first later Info/Warn/Error handler. | Fix the sniffer queue; purge Debug records on disable. |
| **C4b** | **Arc 6's "the `getErrorMessage` family is sub-Info" is plainly wrong — 83 Warn/Error matches.** | Cannot defer that family wholesale. Re-triage by measured level, not assumption. |
| **C5** | **The Error fix, done naively, INCREASES leakage.** `trim(new Error()) === {}` is *over*-redaction (a diagnostics bug). Reusing `baseErrorJson` as-is exposes messages and stacks that may carry RPC credentials, input values, or paths. | Define a log-specific error projection: stable name/code, capped + scrubbed message, stack only under explicit diagnostic capture. Test with secret-bearing URLs. |
| **C6b** | **`gh stack merge` is genuinely atomic**, so partial landing is NOT the hazard. The only real hazard is the `trim()` placement. | Stack shape stands; F1 is the fix. |
| **C7b** | Some secrets are ordinary strings (restore `entropy`, `importedKeysDek`). Brands suit *static* checks on direct arguments only. | Primary design = fixed log-event schemas + per-shape allowlists; narrow runtime denylist as defense-in-depth. |
| **C8** | **"Identifier, not payload" needs site-specific rules.** A `txHash` links private activity; an unsalted origin hash is dictionary-reversible; a contact UUID is useless to support without the DB. | Prefer note type / content arity / render-error class; function name + return-type count; operation + count + outcome; per-session keyed fingerprints where correlation is genuinely needed. |

## Where the two audits conflict

**The ambiguous key `secret`.** Claude: add it, over-redacting ciphertext is free. Codex: never
globally redact it. **Resolved in codex's favour** — `Profile.secret` is ciphertext that appears in
legitimate diagnostics, and blanket redaction degrades exactly the debugging the logs exist for.
Instead redact the *specific* plaintext-bearing shapes (`ActiveSession`, `RestoreSecret`) by shape,
not by the bare name. Claude's cost argument ("free") is wrong: the cost is diagnostic value, which
C8 shows is already the scarce resource here.

## Structural disagreement with the plan, adopted

Both auditors independently concluded **arc 5's lint half is weak** (`noConsole` covers 69 of ~365
sites, constrains neither `this.log*` nor imported packages, and says nothing about content) and
that **outline B's retention gate should be promoted to Arc 0** as the primary control rather than
an alternative. Adopted — see the revised plan.
