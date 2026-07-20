# Codex audit — contacts-sender-decouple (light tier, single audit)

Model: gpt-5.6-sol @ xhigh, read-only sandbox, fresh session against the v1 draft
(plan baseline `dev` @ `cff0ba2`). Session id `019f80c1-d4e2-7aa2-987e-7ce8541e8aa7`
(transcript retained in the session's scratch dir; response reproduced verbatim below).

## Verdict

`conditional approve (with conditions: require a real receive E2E, correct the delivery/package
claims, remove hidden sender migration, harden import semantics, and fix the test gates)`

## Response (verbatim)

### (1) Adversarial/security

- Custom/older tokens remain the main compatibility risk. Explicit `via_address_derived_secret()`
  is not the only route: an external sender's wallet hook can choose address-derived delivery for
  an unconstrained transfer. Nulo having no hook governs Nulo-originated sends, not notes Nulo
  receives.
- Hostile imports are under-analyzed. Curve validation prevents invalid points, not resource
  exhaustion. An unbounded file containing many valid `isSender` addresses can grow scan state
  and repeatedly invalidate contract-sync caches. Add file/row limits, deduplication, and
  explicit confirmation with a count.
- Silent edit/import migration is itself a privacy regression: it registers a new address without
  explicit consent and deletes the old discovery source, potentially losing delayed or historical
  legacy-log discovery.
- Standard Fee Juice claims appear unaffected: canonical Fee Juice is public; private-FPC notes
  arise through user-controlled/self flows. Self-sends use PXE's local-account handling.
  Offchain-delivery tokens remain dependent on explicit ingestion—registration cannot rescue
  them.
- Multi-device/offline recovery deserves a cold-PXE test. On-chain handshakes should be
  rediscoverable with the same keys, but a receiver already running before the transfer does not
  prove fresh-device catch-up.
- A malicious dApp with `addressBook=true` can already register many senders and amplify
  scanning. That is pre-existing, but it is the obvious retained attack surface.

### (2) Assumptions

- **Facts:** The installed dependency is `@aztec-foundation/aztec-standards@5.0.1`, not
  `@alejoamiras/aztec-standards`. Its artifact's embedded source does confirm both
  private-balance writes use `onchain_constrained()`. Fact 9 is overbroad because
  wallet-hook-selected address-derived delivery also exists. "Offchain needs no registration"
  should say "offchain requires explicit message ingestion."
- **Inferences:** I1 can become a fact based on the actual installed artifact plus live test. I2
  is unsafe: sender rows are independent state, not stale contact metadata; leave them untouched.
  I3 is false as written: old `isSender` values often came from the former default-on behavior,
  and export unions senders across networks while import registers them only on the currently
  active network.
- **Asks:** A1 is harmless copy preference. For A2, choose leave-alone. Missing asks: define the
  cross-network import policy, decide whether imported sender counts require explicit
  confirmation, and explicitly accept/document legacy/custom-token compatibility limits.
- The plan also misses `useContactImportExport.ts`'s merge-by-name migration: it may delete an
  old sender even when the imported row has `isSender:false`.

### (3) Phases and gates

- `bun run test:components` only runs `src/components`; it misses every touched `src/popup/**`
  file. Use full `bun run test` and add focused New/Edit/Import contact tests.
- Phase 6 is directionally correct, but assert immediately before transfer that the exact
  external sender is absent, use a fresh sender/recipient pair, import the token before sending,
  transfer private funds, and assert an exact private-balance delta after confirmed inclusion.
- Cover both packaged constrained delivery and default unconstrained delivery—or narrow the
  enabling claim.
- The fallback is a cop-out. "No Nulo hook" proves neither external-sender strategy nor artifact
  behavior, registry discovery, same-block ordering, or extension synchronization. A live
  two-wallet integration test is the minimum ship gate; `.todo` is not a pass.

### (4) Simpler/better

- Make contacts entirely non-mutating toward sender state: add/edit/delete never touch senders.
- Keep `isSender` for compatibility, but make import registration an explicit, counted,
  active-network action; use full backup for faithful per-network restoration.
- Reuse the already-deployed E2E token instead of deploying another.
- Collapse Phases 1–4 into one UI/copy phase, then focused tests and network proof.

Things that look fine: removing add/delete toggles, retaining the chip, Advanced surface, dApp
RPC, export field, service APIs, and correcting the empty-state copy.

## Post-audit verification + disposition (by the drafting agent)

Every checkable claim was verified in-tree before adoption:
- `@aztec-foundation/aztec-standards@5.0.1` confirmed (`apps/extension/package.json:55`,
  `vite.shared.ts:47`) — the draft's `@alejoamiras/*` name came from a stale pre-5.0.1
  `node_modules`; corrected.
- The merge-by-name migration deleting a sender on an `isSender:false` row confirmed at
  `useContactImportExport.ts` (activeSenderSet snapshot + `oldSenderAddressToUnregister`).
- `test:components` scope confirmed (filtered to `src/components`).

Disposition of each condition is recorded in plan.md § "Codex audit" (all five conditions
adopted; the unconstrained-delivery e2e coverage partially adopted as a claim-narrowing; the
phase collapse adopted in spirit).

---

# Codex post-implementation audit (session `019f8147-ee70-7783-a0c0-383e11cff692`)

## Verdict

`conditional approve (with conditions: harden import bounds/canonicalization, correct misleading
sender copy, and strengthen the claimed behavior pins)`

## Findings (verbatim)

1. **Medium — hostile import remains allocation-amplifiable.** The 512-row check occurs after
   `file.text()` and `JSON.parse()`, so a huge file is fully materialized first. Import then
   spreads every unvalidated row, copying arbitrary extra properties. Add a file-byte limit,
   validate minimal row shapes, and construct only `{name,address,isSender}`.
2. **Medium — address dedup is not canonical.** Dedup uses the sanitized string verbatim, while
   valid hex is case-insensitive. Mixed-case representations of one Aztec address can bypass
   dedup and produce repeated contact/PXE operations. Popup edits can also recreate duplicates
   after the initial dedup. Canonicalize before comparison and re-dedup immediately before
   service calls.
3. **Medium — Advanced copy overstates the guarantee.** senders/index.vue says deletion "only
   affects" legacy tokens, omitting unconstrained transfers whose sender wallet deliberately
   chooses address-derived delivery. This could induce deletion of a still-needed registration.
4. **Low — consent copy/tests have holes.** The banner's singular/plural is correct, but "1
   sender will be registered on no active network" is contradictory; the eventual toast also
   says "1 senders registered." The banner tests neither deselection-driven count changes nor
   no-network wording despite claiming selection tracking.
5. **Low — behavior/test integrity gaps.** Edit's disabled-button dirty gate is bypassed by
   Enter because `handleUpdateContact()` checks validity but not dirtiness. New/Edit component
   tests do not actually spy on account-state construction or mutation. The add-contact network
   pin checks the chip immediately after the contact row appears, leaving a race where a delayed
   sender mutation could escape detection; inspect the settled Advanced sender list before
   registering there.
6. **Low — cleanup incomplete.** Runner-generated `.e2e-state/ports.json` remains changed, and
   `deleteContact` still documents/accepts the removed unregister toggle. `git diff --check`
   also reports a trailing blank line.

Looks fine: no residual contact add/edit/delete sender writes; import is adds-only; the
merge-by-name "never deletes" test genuinely pins `deleteSender`; Reset Changes restores both
fields; the receive e2e strongly pins zero senders + exact 0→25 delta + post-transfer zero
senders; all `addContact` callers migrated; dApp RPC/capability paths unchanged.

## Disposition

All six findings addressed (adopted or explicitly rejected with reason) — the full table lives
in plan.md § "Post-implementation review round".
