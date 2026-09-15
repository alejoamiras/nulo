/**
 * `isStaleAnchorMessage` matches upstream text by substring, so an `@aztec` bump that rewords a
 * diagnostic would silently turn the retry off. Two of the three strings live in installed
 * packages and are pinned here against the shipped files; the node-server one
 * (`node_world_state_queries`) is not installed client-side and is tracked in UPDATE.md instead.
 */
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)

describe("stale-anchor message sources", () => {
	test("@aztec/pxe still throws the not-yet-synchronized diagnostic from its anchor block store", () => {
		const bundleEntry = require.resolve("@aztec/pxe/client/bundle")
		const dest = join(dirname(bundleEntry), "..", "..", "..")
		const source = readFileSync(join(dest, "storage", "anchor_block_store", "anchor_block_store.js"), "utf8")
		expect(source).toContain("not-yet-synchronized PXE")
	})

	test("the HandshakeRegistry artifact still carries the RewindableRegister assertion", () => {
		// The package's `./artifacts/*` export appends `.json` itself.
		const artifactPath = require.resolve("@aztec/noir-contracts.js/artifacts/handshake_registry_contract-HandshakeRegistry")
		expect(readFileSync(artifactPath, "utf8")).toContain("RewindableRegister write originates behind")
	})
})
