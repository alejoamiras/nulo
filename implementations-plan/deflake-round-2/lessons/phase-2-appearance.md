# Phase 2 (PR-2 appearance/A1) — lessons

## Root-cause discipline paid twice

The recon's two hypotheses BOTH died on contact with evidence: rAF-throttled polling was
already neutralized page-wide by `patchPagePolling` (codex + repro concurred), and the failing
waiter wasn't the html[theme] poll at all. The repro (retry=0, controlled CPU hogs with owned
pgids) pinned the real mechanism in one failing run: `setTheme`'s one-shot `offsetParent`
sample vs DropdownRoot's close `<Transition>` — leaving items stay visible while `isOpen` is
already false; the sample reads "open", skips the trigger, and the option click waits on a
closing menu. A wait can only be as honest as the SIGNAL it polls: visibility is a rendering
artifact; `isOpen` is the state. Fix = expose the state (`data-dropdown-open`, synchronous,
component-pinned) and gate on it.

## Evidence

- Pre-fix: 1/10 load runs failed (theme-cycle, 17s, clickByTestId("theme-dark-btn") 10s
  timeout — first-attempt error visible only because retry=0).
- Post-fix: 30/30 load runs zero failures (two 15-run batches); no bound changed anywhere.
- Animations leg: never reproduced locally in 30 pre-fix runs (CI signature: ~2-3s fast fail =
  the `expect(after).not.toBe(before)` assertion losing the 150ms-sleep race). The sleep is
  indefensible against a multi-hop RPC/broadcast chain regardless — replaced with the
  `data-toggle-active` gated wait (the privacy-toggle helper's proven idiom); the persisted
  read needs no extra wait (the remount's getProps resolves before the v-if renders the
  toggle).

## Census note

The full-suite retry census (plan PR-2 phase d) runs AFTER PR-1's reporter is merged so
census runs surface first-attempt errors inline.
