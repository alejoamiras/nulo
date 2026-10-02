# Lessons — planning phase

## 2026-09-16 — codex round-1 audit failed on account quota

- Foreign-reviewer leg (`/codex high`, GPT-6 Astra, session `01a0ab49-677f-7311-9a48-78867b36b579`)
  read ~17 files of the plan's citations, then the account hit its ChatGPT usage limit:
  `"You've hit your usage limit … try again at Sep 19th, 2026 8:34 PM"`. No response was produced;
  `response.md` was never written. Not a model or policy issue — an account quota.
- The Anthropic-family leg (Opus 5, `Plan` agent) ran in parallel and is recorded in `audit-fable.md`.
- Consequence: the blueprint's dual audit is one-legged until quota returns or credits are added;
  the fresh-context final pass and the implementation's codex fix loop have the same dependency.
  Surfaced to the owner at the gate rather than substituting a same-family pass for the foreign one.

## 2026-09-16 — rev 2 written on the fable leg alone

- Folded the Opus round-1 report (14 findings, all verified) plus owner decisions D5–D7 (lock cancels; warn at the lock button, never block; auto-lock defers). `ProfileDriftError` became `SessionEndedError` because a lock is now a session end like a switch — one error, one kind, one card subtitle.
- The gate is presented as provisional: the codex round on rev 2 and the fresh-context pass run when quota returns; no implementation starts before both have a verdict.

## 2026-09-16 — codex round 2 (rev 2) → reject; rev 3 written

- Owner re-logged codex into a subscribed account; round 2 ran on rev 2 (session `01a0ab93-93fb-7993-9f2d-517099fd0be4`). Eight findings, all verified against source before folding; transcript in `audit-codex.md`.
- The two CRITICALs changed the design: an identity compare cannot see A→B→A, so the fence now carries a per-session serial; and the post-prove window was a defect, closed by a synchronous liveness check in the same tick as `sendTx` (close() clears memory before its first await).
- The reaper-bounds-the-deferral claim was false (heartbeats keep `updatedAt` fresh without ceiling) — replaced by an absolute cap, surfaced as Ask A1.
- Both audits together added eight Facts (27–34) that rev 1 and rev 2 did not have; the read-site inventory in recon.md missed `transfer-estimate-reuse.ts:176` and the fee-strategy builder callers.

## 2026-09-16 — codex round 3 (rev 3) → reject; rev 4 written

- Six findings, all verified. The sharpest: rev 3's flow diagram had silently dropped the existing post-`submitting` cancellation check — a session check is not a job-cancellation check. Lesson: when redrawing a frozen sequence in a plan, copy it from the source, never from memory.
- The "absolute cap" was hollow while `refresh()` reset it: the silent dApp path refreshes the session on every call. Fixed by not resetting; the underlying TTL activity policy (dApp activity counts) predates this plan and is scoped out with the consequence stated.
- Off-lock decisions that await a predicate need coalescing + snapshot revalidation, not just an identity guard — the same object can be refreshed under them.

## 2026-09-16 — codex round 4 (rev 4) → reject; rev 5 written; fix-loop hard stop reached

- Six findings (1 HIGH, 5 MEDIUM), all verified. `applyTtlChange` writes the deadline under the facade lock only, so three writers held three different locks — identity guards cannot order them; rev 5 funnels every deadline write through one artifact-locked CAS (`commitDeadline`).
- Test-construction lessons: parking the `submitting` storage write cannot exercise the `:303` check because the journal transition lock spans the write — park the cancellation instead; popup navigation refreshes the session, so an inactivity e2e must observe through a non-refreshing RPC.
- Three resumed rounds is the blueprint hard stop. The design has been stable since rev 3 (serial + synchronous broadcast check); r3/r4 corrected mechanics and tests. Surfacing to the owner with the fresh-context pass as arbiter rather than a fourth resume.

## 2026-09-16 — fresh-context codex pass (rev 5) → reject; rev 6 written

- Two HIGHs the resumed session never saw because it was anchored on the dApp path: the auth-registry UI entries await network/storage reads BEFORE calling `executeSendTransaction` without a fence (a lock + same-profile re-unlock in that window yields the new serial), and `clearBearer` is a fourth writer of the live session row under a different lock. A fresh reader finds callers and writers the incumbent stops enumerating.
- Test-construction: an inactivity e2e that records `t0` before a flow that navigates twice proves nothing; read the persisted deadline after the last navigation and assert it advanced while `since` did not.
- `gh stack init` has no `--adopt`; existing branches are adopted automatically, use `--base dev`.

## 2026-09-16 — second fresh-context pass (rev 6) → reject on one HIGH; rev 7 written

- One finding: a CAS that gates EVERY mutation on the expected deadline lets a stale-decision writer that wins the lock first erase a must-apply mutation (strict-mode bearer removal). Lesson: "serialize all writers" is necessary but not sufficient — classify writers by whether their decision predates the lock (CAS, stand down) or is made inside it (always apply).
- Codex reproduced it in a model against the real `Lock`; a fresh reader with no stake in the previous rounds is what caught it. Everything else — the send graph, the serial, the registry, the eleven composition cases, the three e2e — held.
- Two citation errors of my own (Fact 46 pointed at funding waits; Fact 2 misquoted a comment). Quote comments by copy, not by memory.

## 2026-09-16 — round 7 → conditional approve; rev 8 closes the conditions

- Two prose corrections, no algorithm change: bearer-removal-first does not make the deferral stand down (its expectation still matches — both commit), and `restore` publishes without writing the row. Seven adversarial schedules modelled against the real `Lock` came back correct.
- Six audit rounds on one plan, five rejects. Every reject was earned: two design changes (serial, synchronous broadcast check), one dropped-checkpoint regression in my own redraw, three writer/caller enumeration gaps, one CAS semantics error. The pattern: the incumbent reviewer stops enumerating once the central mechanism is right; a fresh reader finds the callers and writers at the edges. Budget future mid plans for at least one fresh pass after the resumed loop converges.

## 2026-09-16 — rendering the UI impact with the real components

- Owner asked for the dialog and cards as they would look in the app, not CSS sketches. Throwaway Storybook stories (deleted after) rendered `ConfirmPopup` over an Activity list and `TransactionTerminalCard`; screenshots at 360×600 (CSS `zoom: 2` for 2x) in both themes are embedded in the ELI5 artifact.
- Two Storybook faults found on the way, both pre-existing and out of this plan's scope: (1) `apps/extension/.storybook/main.ts` passes `dirs: ["../src/components"]` to `unplugin-vue-components`, which resolves relative to the vite root, so no local component (Popup, PopupCard, Button) auto-registers under Storybook — `FormPopup` stories render an unresolved `<Popup>` tag; an absolute `fileURLToPath(new URL("../src/components", import.meta.url))` fixes it. (2) `preview.ts`'s `ensureChromeStub` returns early when `globalThis.chrome` exists, and Chromium exposes a native `chrome` object (loadTimes/csi/app) on ordinary pages, so the stub never installs there and any store touching `chrome.storage` throws. Neither fixed here; candidates for a chore PR.
- Never register the local `Button` wrapper globally as "Button": the design `Button` renders `<component :is="tag">` with `tag="button"`, and Vue's dynamic resolution also tries the capitalised name, so it resolves to the wrapper and recurses (`Maximum call stack size exceeded` in `setFullProps`).
- The real render surfaced a copy question the sketch hid: a red `ConfirmPopup` confirm prints the pre-title "Irreversible" (keyed to `confirm_color`), which is wrong for a cancel; and `showPopupFullscreen` defaults on, so the sheet fills the popup. Both put to the owner in the ELI5.
