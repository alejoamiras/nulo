import { readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { NULO_DESIGN_COMPONENTS, nuloDesignResolver } from "./design-resolver"

const here = dirname(fileURLToPath(import.meta.url)) // apps/tools/scripts
const srcDir = join(here, "../src")

describe("design-resolver", () => {
	// No faucet-local SFC may share a name with the resolver set: with dirs:[] the resolver only fires
	// for unimported bare tags, but a same-named local component would still be the one a bare tag means
	// to render. This pins that the resolver can never silently shadow a local component. Scans ALL of
	// src/** (not just src/components) so an SFC in views/ or a nested folder can't slip a collision past.
	test("no faucet-local SFC name collides with the resolver set", () => {
		const localNames = (readdirSync(srcDir, { recursive: true }) as string[])
			.filter((f) => f.endsWith(".vue"))
			.map((f) =>
				f
					.split("/")
					.pop()!
					.replace(/\.vue$/, ""),
			)
		const collisions = localNames.filter((n) => NULO_DESIGN_COMPONENTS.has(n))
		expect(collisions).toEqual([])
	})

	test("resolves a known primitive to @nulo/design", () => {
		expect(nuloDesignResolver()("Flex")).toEqual({ name: "Flex", from: "@nulo/design" })
	})

	test("ignores unknown names (explicit imports / local components win)", () => {
		const resolve = nuloDesignResolver()
		expect(resolve("Button")).toBeUndefined()
		expect(resolve("WalletPanel")).toBeUndefined()
	})
})
