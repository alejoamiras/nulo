# Light Theme Fix — wrap-up

**Branch:** `fix/light-theme` (12 implementation commits + code-review fix + docs, off `dev@3e392be`)
**Status:** all 6 phases ✓; code-review done; codex post-impl audit pending; **ready for PR + your manual light-mode smoke.**

## What shipped
- **The wallet light theme works.** Root cause was 8 brand tokens missing from `[theme="light"]` in `@nulo/design/base.css` (so 555 sites inherited dark) + a `--border` mis-alias + ~37 hardcoded dark literals + 3 undefined "ghost" tokens. All fixed.
- **A Direction-A warm-chromatic palette** (accent `#a8480c` burnt amber) — every semantic text/background/accent pair is **WCAG-AA verified by an automated gate** (18/18, both themes).
- **A faucet Dark/Light/System toggle** matching the wallet (localStorage-persisted, follows OS, no flash).
- **Flash-of-dark killed** in both apps via a CSP-safe pre-paint boot script + localStorage hint.
- **Two new permanent guards:** a contrast gate (catches "structurally valid but visually broken") + an undefined-var guard (catches ghost tokens — it found 2 the inventory missed).
- **Dark theme frozen** — the only dark change is an additive `color-scheme: dark`.

## Contentious decisions (debated with codex + the audits)
1. **Accent: chromatic, NOT ink (audit H2).** The consolidated plan proposed a near-black "ink" light accent. The hostile audit caught that `--nulo-accent` is *also* links / active-tab / Toggle-ON across **43 sites** — ink would make a link look like body text and an **ON security-toggle look OFF**. We switched to a saturated amber so interactive elements still read as interactive. *This was the single most valuable audit catch.*
2. **FOUC: CSP-safe external script (audit C1 + final-codex re-review).** Two earlier fixes were wrong: the "synchronous `new Config()`" port still flashed (it reads the `system` default, not the persisted choice), and a `@media (prefers-color-scheme)` fallback missed the 6 components with `[theme=…]`-gated styles. The fix codex itself pointed to: an *external* `theme-boot.js` (the extension CSP forbids only *inline* JS — external `'self'` scripts are fine; precedent `console-sniffer.ts`) that sets the real attribute pre-paint.
3. **The contrast gate is an honest pairing table, NOT a cascade resolver (audit C2).** The repo's own `app.css.parity.test.ts` documents that jsdom can't resolve the CSS-var cascade. So the gate resolves the *token graph* in base.css and checks hand-curated pairs — only as complete as its pairing list, with the Storybook matrix + manual smoke covering the rest. Honest, achievable, still catches the root bug.
4. **`audit:vue` doesn't run the design gate (audit H1).** It runs extension tests only — so the contrast gate is invoked explicitly in the phase gates (and a follow-up should wire `test:all` into CI).
5. **The accent was darkened `#b8530f` → `#a8480c` by the gate.** The first amber passed the link role but the gate caught it at **4.29:1** on the *fill* role (white text on accent) — below AA. The gate arbitrated; I darkened until 5.06/5.84. (My first by-hand check used a buggy hex parser — the gate's parser is the source of truth.)
6. **Tokenization is byte-identical in dark by construction** for the alpha-on-token cases (`color-mix(--token X%, transparent)` ≡ the old `rgba()` when the token resolves to the same literal — e.g. `--nulo-accent` dark IS `rgb(248,241,231)`).
7. **The post-impl codex audit BLOCKED on sub-AA security copy — and was right.** Light `--txt-body` (3.36:1) / `--txt-tertiary` (2.43:1) carry the scam-token trust prompt, the "irreversible" confirm, and reset guidance — below AA, exactly the release-blocking "warning hiding in light mode" the plan named. The gate had a hole (it never checked those tokens). Fixed: raised the light muted tokens to AA (58/56/56%) + added a required gate suite asserting them on every surface. Codex re-audit: **ship**. (Digging in surfaced that DARK's muted scale is *also* sub-AA — pre-existing, frozen, shipped — so I fixed the new light theme and surfaced dark as a follow-up.)

## Open items (for you)
- **Manual light-mode smoke** (agent can't render UI): send-confirm (amounts/fees), dApp-connect, passkey ceremony dialog, address displays, JSON/Logs viewers, warning/danger banners, and the affordance check (links read as links, ON toggles read as on). View via `bun run --cwd packages/extension storybook` (Theme toolbar) or `bun run --cwd packages/extension dev` (Settings → Appearance → Light) + `bun run --cwd packages/faucet dev`.
- **M1 (accepted):** a one-time first-open flash for pre-existing users who chose an explicit theme *differing from their OS* — self-heals after the first config replay. No synchronous fix exists.
- **Dark muted-text is also below AA (pre-existing, surfaced by the post-impl audit).** `--txt-body`/`--txt-tertiary`/`--txt-support` are a de-emphasized scale that's sub-AA in the *shipped, frozen* dark theme too — including for the same security copy. Out of this plan's "dark frozen" scope, but **worth a follow-up** to raise dark muted contrast (accessibility + the same scam-warning legibility concern).
- **Deferred Asks** (out of approved scope): delete dead `--btn-*` tokens; `:root` fallbacks for `--json-*`/`--log-*`; onboarding reading the persisted theme; wire `test:all` into CI so the dark-freeze guard runs on every PR.
- **e2e:** smoke is **environmentally flaky** in this setup (4 runs → a *different* test fails each run: `wallet-lock`, then `passkey-backup`; the headless WebAuthn/passkey ceremony is timing-sensitive). My diff touches none of the failing flows, 67–69/76 pass every run incl. popup boot, and `passkey-backup` *passed* in run 1 with the same code — conclusively pre-existing flake, not a regression. Smoke is advisory per CLAUDE.md.

## To open the PR
`gh pr create --base dev` — the PR title becomes the squash commit; suggest `feat(design): light theme — fix the broken extension theme + faucet toggle`.
