# P2 lessons — `error.kind` humanization via whitelist

## Outcome

`fix(activity): humanize error.kind on journal detail (whitelist)` — typecheck clean, 60/60 in
`journal-state.test.ts` (47 prior + 13 new). Closes codex post-impl audit **H2** + opus **C1**.

## What shipped

- `journal-state.ts:humanizeErrorKind(kind: string): string` — pure switch returning
  user-facing labels for every documented `JobError.kind` plus the catch-all `"Error"`.
- `popup/pages/journal/[id].vue` — imports `humanizeErrorKind`; the "Reason" row at the
  `journal-detail-error-kind-tag` testid renders `{{ humanizeErrorKind(errorKind) }}` instead
  of the raw kind. Testid preserved verbatim.

## Whitelist coverage (verified)

Source-of-truth cross-check against `wallet-core/jobs/types.ts` documented values +
`failedSubtitleFor` switch in `journal-state.ts` + `reaper.ts` emissions +
`execution/service.ts:normalizeError` call sites:

| kind | label |
|---|---|
| `network` | Network |
| `simulation` | Simulation |
| `prover` | Proof generation |
| `popup_bound` | Popup closed |
| `dapp_execute` | dApp |
| `transfer` | Transfer |
| `sw_restart_post_prove` | Browser restart |
| `stale_on_resume` | Stale on resume |
| `stuck_proving` | Stuck proving |
| `stuck_queued` | Stuck queued |
| `user_rejected` | User rejected |
| `unknown` | Unknown |
| _anything else_ | Error |

The `default → "Error"` arm is the leak guard — if a future kind is added in `wallet-core`
without updating this whitelist, the raw kind never reaches the UI.

## Tests

13 new cases in `journal-state.test.ts`:

- 12 explicit whitelist pins (one per kind).
- 1 fallback case (`metadata_fetch`, `totally_new_kind`, `""` → `"Error"`).
- `stuck_queued` carries a `(REGRESSION PIN)` marker — reaper.ts emits it on queued-record
  time-out (verified at `reaper.ts:192` + the `reaper.test.ts:102` + `:136` assertions).
  Pre-fix it leaked the raw kind into the UI. This pin guards against re-introducing the
  leak via "whitelist drift" — e.g. someone deletes the case during refactor.

## What I cut vs the plan v1.2 draft

Plan v1.2 §P2 mentioned a possible `console.warn` side effect when the default arm fires.
**Cut per codex final-review Low** ([audit-codex-final.md:5](../audit-codex-final.md)) —
`journal-state.ts` is a pure mapping utility today, the default → "Error" already closes
the leak, and adding telemetry would expand the surface for no immediate value. The pure
helper stays pure.

## Files

- `packages/extension/src/utils/journal-state.ts` (+`humanizeErrorKind`)
- `packages/extension/src/utils/journal-state.test.ts` (+13 cases, total 60)
- `packages/extension/src/popup/pages/journal/[id].vue` (import + render swap)

## Open items

None — P2 is self-contained. Next phase: P3 (RecentActivityView IncomingTransferService wiring).
