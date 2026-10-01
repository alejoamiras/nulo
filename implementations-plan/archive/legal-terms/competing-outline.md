# Competing outline — legal-terms

The alternative architecture, written before the audits so they compare two shapes instead of
critiquing one. `plan.md` is **Shape A**; this file is **Shape B** plus the fork-by-fork reasoning.
Both satisfy the binding constraint in `recon.md`: nothing may withhold the session.

## Shape B — service-owned acceptance, router-enforced

1. **`LegalService` (a real `IService` + client)** owns the record. UI never writes storage: it calls
   `legal.accept(surface)`; the service worker stamps `acceptedAt` and the versions from its own
   compiled manifest, emits `onAcceptanceChanged`, and exposes `getStatus()`.
2. **Enforcement in the router, not an overlay.** `meta.requiresLegalAcceptance` on `send` and the
   `windows/execute` route, handled in `route-guard.ts`'s `lateDecision` ladder, redirecting to a
   `/popup/legal` page (the NotNow + ReAccept boards as one routed page).
3. **dApp side**: the execute window refuses to mount; the dispatcher is untouched.
4. **Record per profile** (`nulo:legal:accepted@${profileId}`), included in full backups.
5. **Deltas derived** by parsing the `## Version history` table out of `legal/terms.md` at build time.
6. **Licence notices as a Vue route** (`#/windows/licences`) in the popup bundle, fed by a generated
   JSON asset — the Logs-viewer shape.

## Fork by fork

| Fork | Shape A (plan) | Shape B | Why A |
|---|---|---|---|
| Who writes the record | UI through the storage facade, mirroring `createOnboardingFlag()` | `LegalService` RPC | The record is not a security boundary against the device owner — anyone who can write `chrome.storage.local` owns the wallet already. B buys an `IService`, a client, startup ordering and composition-test surface for no added guarantee. A's cost: two writers (onboarding tab, popup) share one helper in `@/utils/`. |
| Where sending is refused | Service worker: one `assertLegalAcceptanceCurrent()` entered by `executeTransfer`, `executeOperations`, and the head of the dispatcher's guard ladder; UI disables on top | Router `meta` + window refusal | A route guard is UI-only: an already-approved interaction in flight across an extension update, or any future caller of `executeOperations`, walks past it. B also leaves a connected dApp hanging on a window that never resolves instead of receiving a typed error. |
| Record scope | One device-local key; survives profile reset; **not** in backups | Per profile, backed up | The agreement is between a person and the developer about *this install*. Per-profile makes `createAndActivateProfile()` and `profile/new.vue` new gate sites, and a backed-up acceptance restores "I agreed" onto a device where nobody clicked anything — the opposite of evidence. The approved Settings mockup already says "Kept on this device… not part of a backup." |
| Delta authoring | Hand-written per material version in the `@nulo/legal` manifest; tests pin manifest ↔ markdown | Parsed from the markdown table | The re-accept sheet is a legal summary a person must stand behind. Parsing prose into UI copy makes a table edit a silent UI change, which the UI sign-off rule exists to prevent. |
| Licence notices | `THIRD-PARTY-NOTICES.txt` emitted at the build root, opened in a tab | Vue window over generated JSON | Owner's Phase 0 answer. Also the stronger compliance artifact: the notice ships in the zip whether or not any UI renders it. B reads nicer; it can be layered on later without changing the generator. |
| Declined-state surface | Always-mounted dismissible sheet + a declined screen, popup only | Routed page | The sheet has to appear over whatever route the popup restores to; an overlay does that without touching every route's `meta`. Unlike the two existing barriers it is dismissible and never covers auth. |

## Where B is genuinely better

- **One writer.** If a third acceptance surface ever appears, A's shared helper is a convention; B's
  RPC is a wall.
- **Eventing.** A relies on `chrome.storage.onChanged` for the popup to notice an acceptance made in
  the onboarding tab. That is the same mechanism the two barriers already use, but it is the piece of
  A most likely to be flaky under test.

Neither is decisive at this size. If the audits find a second writer or a reactivity bug class,
promote the write path to B's service without changing the record shape or the enforcement points.
