# Phase 1 — Decouple the contacts UI

## What shipped
- `NewContactPopup.vue`: removed the register-as-sender toggle row + `registerAsSender` form
  field + the conditional `addSender` branch and dual-outcome toast; dropped the now-unused
  `AccountStateServiceClient` and `useAppStore` usage; single "Contact is added" toast.
- `EditContactPopup.vue`: full rewrite without sender state — removed the toggle, the
  `initialIsSender`/`desiredIsSender` two-state model, `loadSenderState`, `applySenderDelta`
  (incl. the address-migration truth table), the sender event subscriptions, and the
  `isLoadingSenderState` submit gate. Submit now requires name/address dirty (sender-only dirty
  no longer exists). The show-watcher lost its sync-set-loading-flag dance (it existed solely to
  fence the sender toggle race).
- Contacts page `handleDeleteContact`: plain delete-confirm; removed the `confirm.toggle` block,
  `unregisterSender` ref, and `deleteSender` branch. Chip infra (`syncSenders`/`isContactSender`
  + sender event subscriptions) kept for the read-only ContactRow chip. Dropped the now-unused
  `TOAST_DURATION` import. `ConfirmPopup`'s generic toggle capability left in place (generic UI,
  no other current consumer).
- `useContactImportExport.ts`: removed the merge-by-name sender-migration block (the
  `activeSenderSet` snapshot + `oldSenderAddressToUnregister` delete — the audit-confirmed path
  that deleted a sender even for `isSender:false` rows). Import is now adds-only toward sender
  state. Added per-address dedup (first row wins) after sanitize.
- `contacts-export-format.ts`: added `MAX_CONTACT_IMPORT_ROWS = 512` cap enforced in the strict
  parser (hostile-file bound; there was NO cap before — audit finding confirmed).

## Notes
- No component tests existed for the three popups, so no test deletions were needed in this
  phase; `ContactRow.test.ts` untouched and green. Focused new tests land in Phase 3; e2e
  reference to the removed `new-contact-register-sender` testid is Phase 4's job.
- Remaining `getSenders` call sites verified legit post-change: Advanced senders page,
  NewSenderPopup, the contacts-page chip sync, and the service layer.

## Validation gate (plan Phase 1)
- `bun run lint` → exit 0 (repo-standing warnings/infos only, no errors)
- `bun run typecheck` → exit 0
- `bun run test` → 267 files passed | 1 skipped, 3173 tests passed | 7 todo
