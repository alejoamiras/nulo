# P10 lessons — B1 brutalist restructure of journal/[id].vue

## Outcome

`feat(journal-detail): brutalist restructure mirroring tx/[id] + categorical failure label` —
typecheck clean. Full template + style module rewrite of
`journal/[id].vue`. Did NOT touch `tx/[id].vue` (user QA: it looks
great as is).

## What shipped

Structure now mirrors `tx/[id].vue`'s information hierarchy:

```
SubPageHeader (existing — title routes to /popup/activity)
└ hero_meta row     ← terminal timestamp (mono, dim)
└ amount block      ← only when transfer kind (mono-monumental + caption)
└ categorical chip  ← NEW: from P9's categoricalLabel.label
└ origin chip       ← when dapp_execute (sanitized; "App: <name>")
└ details_box       ← rows of detail_key / detail_value_mono
     ├ "What happened" → category.context (one-line explanation)
     ├ "Reason" → humanizeErrorKind(error.kind)
     ├ "Started" / "Ended" → ISO-formatted timestamps
     └ "State" → icon + display.state
└ dev_box           ← developer/debug-mode-gated raw error envelope
```

Verbatim style tokens borrowed from `tx/[id].vue`: `.hero_meta`,
`.tx_time`, `.amount_value`, `.amount_symbol`, `.amount_caption`,
`.transfer_type_chip` (mapped to new `.category_chip`),
`.details_box`, `.detail_key`, `.detail_value_mono`, `.empty_headline`,
`.empty_sub`. The 1px borders + mono labels + `--nulo-border` /
`--nulo-secondary` / `--nulo-surface-low` color tokens carry the
brutalist rhythm.

## Sanitize boundary preserved

The new category chip + context line come from `categoricalLabel(op)`
(P9 helper) which consumes ONLY wallet-controlled fields. The origin
chip continues to wrap dApp-controlled `op.subtitle` via
`sanitizeJournalSubtitle`. No new render path for dApp strings.

The P9 sanitize-invariance test pin (`categoricalLabel` called with
a malicious `op.subtitle` returns sanitize-invariant strings)
protects against future regressions where someone wires `op.subtitle`
into the categorical helper.

## Developer-mode raw error block preserved verbatim

Per user QA: "I like the 'developer mode on' error showing btw."
The `dev_box` section is the exact same gating
(`developerMode || debugMode`) and the same `<pre>` blocks with
`incoming-trust-message` / `incoming-trust-raw` testids.

## Component test deferred

A focused mount test for `journal/[id].vue` (per-kind category chip
render + dev-mode gating + origin sanitize) would need stubs for 3
service clients + `useAppStore` + `useToast` + `useRoute` + `useRouter`.
No precedent for popup-page tests in the codebase. Deferring to
manual QA in P13 + the P9 sanitize-invariance unit test which covers
the load-bearing security claim.

## Files

- `packages/extension/src/popup/pages/journal/[id].vue` (~250 LoC
  rewrite: template restructure + ~120 LoC style module replacement).

## Open items

- P13 manual QA: visual review pre-squash + sign-off on P9's copy
  table.
