import { describe, expect, test } from "vitest"
import { NULO_DESIGN_COMPONENTS, nuloDesignResolver } from "./design-resolver"

/**
 * Resolver-inventory pin (design-system round-2, D-SEAM). `NULO_DESIGN_COMPONENTS` must equal EXACTLY
 * the set of names the extension routes to `@nulo/design` — NOT "every package export" (the package
 * also exports names the extension keeps LOCAL + service-bound, e.g. `AddressDisplay`/`EmojiGrid`,
 * which must never enter the resolver). Wrapper-backed names (`Button`/`SubPageHeader`/`ToastManager`)
 * stay local and must be ABSENT (else the bare tag resolves to the package base instead of the wrapper).
 *
 * Round-1 vs round-2 split (don't overclaim "deleted"): the ROUND-2 names (Spinner/Banner/LoadingState/
 * Tooltip/Popover/Input) had their extension-local SFC DELETED, so `components.d.ts` resolves them to
 * `@nulo/design`. The ROUND-1 names (Flex/Icon/Text/MaterialIcon/Badge/BrutalistTitle/Checkbox/
 * SectionLabel/Toggle) are in the resolver but their local SFCs were NOT deleted in round 1 — the
 * dir-scan still SHADOWS them to local files, so for those names this set is ASPIRATIONAL pending the
 * round-3 local-SFC cleanup (see round-2-backlog.md). Typecheck catches a missing export; only this
 * pins against a wrong or extra remap. Grow `EXPECTED_MIGRATED` in the SAME PR that deletes a local SFC
 * + adds its name to the resolver.
 */
const EXPECTED_MIGRATED = [
	// round 1 — L1 core + the pure L2 subset
	"Flex",
	"Icon",
	"Text",
	"MaterialIcon",
	"Badge",
	"BrutalistTitle",
	"Checkbox",
	"SectionLabel",
	"Toggle",
	// round 2 — P2 Spinner family (local SFCs deleted)
	"Spinner",
	"Banner",
	"LoadingState",
	// round 2 — P5 host-DOM family (local SFCs deleted)
	"Tooltip",
	"Popover",
	// round 2 — P6 Input (local SFC deleted)
	"Input",
]

// Wrapper-backed: the extension keeps a LOCAL SFC of this name, so the bare tag must resolve to that
// wrapper. These must NEVER be in the resolver set.
const WRAPPER_BACKED = ["Button", "SubPageHeader", "ToastManager"]

describe("nuloDesignResolver inventory", () => {
	test("resolver set is exactly the deleted-and-migrated names", () => {
		expect([...NULO_DESIGN_COMPONENTS].sort()).toEqual([...EXPECTED_MIGRATED].sort())
	})

	// `ComponentResolver` is a function|object union; our impl returns the function form.
	type ResolveFn = (name: string) => { name: string; from: string } | undefined

	test("wrapper-backed names are never routed to the package", () => {
		const resolve = nuloDesignResolver() as ResolveFn
		for (const name of WRAPPER_BACKED) {
			expect(NULO_DESIGN_COMPONENTS.has(name)).toBe(false)
			expect(resolve(name)).toBeUndefined()
		}
	})

	test("a migrated name resolves to @nulo/design; an unknown name does not", () => {
		const resolve = nuloDesignResolver() as ResolveFn
		expect(resolve("Flex")).toEqual({ name: "Flex", from: "@nulo/design" })
		expect(resolve("NotAThing")).toBeUndefined()
	})
})
