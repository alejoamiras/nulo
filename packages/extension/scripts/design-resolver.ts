import type { ComponentResolver } from "unplugin-vue-components"

/**
 * Component names that have moved into `@nulo/design`. The extension's templates still use them as
 * bare tags (`<Flex>`, `<Icon>`…); this resolver maps those names to the package so the
 * dir-scan auto-import keeps working with zero call-site churn after the local SFCs are deleted.
 * Shared by the build (`vite.config.ts`) and Storybook (`.storybook/main.ts`) so the list can't drift.
 * Grows as later phases migrate more components.
 */
export const NULO_DESIGN_COMPONENTS = new Set([
	"Flex",
	"Icon",
	"Text",
	"MaterialIcon",
	"Badge",
	"BrutalistTitle",
	"Checkbox",
	"SectionLabel",
	"Toggle",
	// round 2 — P2 Spinner family
	"Spinner",
	"Banner",
	"LoadingState",
])

export function nuloDesignResolver(): ComponentResolver {
	return (name: string) => {
		if (NULO_DESIGN_COMPONENTS.has(name)) return { name, from: "@nulo/design" }
	}
}
