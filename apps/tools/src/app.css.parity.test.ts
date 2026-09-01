import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

// Read the raw stylesheets via fs — `?raw` imports return empty under the faucet's jsdom vitest (the
// vue/css pipeline swallows them). The design package is always at `packages/design` in this monorepo.
const here = dirname(fileURLToPath(import.meta.url)) // apps/tools/src
const appCss = readFileSync(join(here, "app.css"), "utf8")
const baseCss = readFileSync(join(here, "../../../packages/design/src/base.css"), "utf8")

/**
 * Faucet host-rule parity guard (design-system round-2 F9 / round-1 phase-5 lesson).
 *
 * The round-1 faucet light-bg regression slipped past EVERY machine check because token VALUES were
 * byte-identical — the gap was MISSING RULES (the extension's lean `@nulo/design/base.css` dropped a
 * handful of element-global declarations the faucet relied on; they were restored in `app.css`).
 * Token-drift tests can't see a missing rule. This is a rule-PRESENCE guard: the host element-global
 * rule-groups the faucet needs must exist SOMEWHERE in `app.css ∪ @nulo/design/base.css`.
 *
 * Scope: presence, NOT cascade effectiveness — jsdom can't resolve the CSS-var cascade, and a later
 * higher-specificity rule could still win. The guard assumes `app.css` is imported AFTER `base.css`
 * (`apps/tools/src/main.ts`); the human visual gate covers ordering. If a future `base.css`
 * change drops one of these and `app.css` doesn't backfill it, this fails loudly instead of shipping
 * a silent regression.
 */
const css = `${baseCss}\n${appCss}`.replace(/\s+/g, " ")

// [label, regex] — each rule-group must co-occur (selector … { … property) somewhere in the union.
const REQUIRED: Array<[string, RegExp]> = [
	["page background (html/body)", /(html|body)[^{]*\{[^}]*background/],
	["page text color (html/body)", /(html|body)[^{]*\{[^}]*[^-]color\s*:/],
	["page min-height (html/body)", /(html|body)[^{]*\{[^}]*min-height/],
	["button cursor reset", /button[^{]*\{[^}]*cursor/],
	["disabled button cursor", /button:disabled[^{]*\{[^}]*cursor/],
	["input color inherit", /input[^{]*\{[^}]*color/],
	["focus-visible outline", /focus-visible[^{]*\{[^}]*outline/],
]

describe("faucet host-rule parity (missing-rule guard over app.css ∪ @nulo/design/base.css)", () => {
	for (const [label, re] of REQUIRED) {
		test(`host rule present: ${label}`, () => {
			expect(re.test(css), `missing host rule "${label}" — restore it in app.css or @nulo/design/base.css`).toBe(true)
		})
	}
})
