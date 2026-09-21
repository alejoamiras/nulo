import { describe, expect, test } from "vitest"
import { artifactChunkName, packageChunkName } from "./vendor-chunks"

const ISOLATED = "/repo/node_modules/.bun/@aztec+stdlib@5.2.0+c1edb6f0/node_modules/@aztec/stdlib/dest/abi/abi.js"

describe("packageChunkName", () => {
	// The isolated linker nests the package under a `.bun/<pkg>@<ver>` directory of another name.
	test("names a heavy package by its last node_modules segment", () => {
		expect(packageChunkName(ISOLATED)).toBe("aztec-stdlib")
		expect(packageChunkName("/repo/node_modules/@noir-lang/acvm_js/web/acvm_js.js?v=1")).toBe("noir-lang-acvm-js")
	})

	test("leaves app code and every other package to the bundler", () => {
		expect(packageChunkName("/repo/apps/extension/src/popup/main.ts")).toBeNull()
		expect(packageChunkName("/repo/node_modules/vue/dist/vue.runtime.esm-bundler.js")).toBeNull()
	})

	// Its chunk is web-accessible to every page through the content script.
	test("never regroups @aztec/wallet-sdk", () => {
		const sdk = "/repo/node_modules/.bun/@aztec+wallet-sdk@5.2.0/node_modules/@aztec/wallet-sdk/dest/crypto.js"
		expect(packageChunkName(sdk)).toBeNull()
		expect(artifactChunkName(sdk.replace("crypto.js", "schema.json"))).toBeNull()
	})
})

describe("artifactChunkName", () => {
	const token = "/repo/node_modules/@aztec/noir-contracts.js/artifacts/token_contract-Token.json"

	test("gives each json module of a heavy package a chunk of its own", () => {
		expect(artifactChunkName(token)).toBe("aztec-noir-contracts-js-artifacts-token-contract-Token")
		expect(artifactChunkName(token.replace("token_contract-Token", "nft_contract-NFT"))).not.toBe(artifactChunkName(token))
	})

	// Sharing a name would put both in one chunk, and two artifacts are what breaks the limit.
	test("keeps two artifacts with one base name in different directories apart", () => {
		expect(artifactChunkName(token.replace("artifacts/", "target/"))).not.toBe(artifactChunkName(token))
	})

	test("splits a package's modules between the two groups without overlap", () => {
		expect(packageChunkName(token)).toBeNull()
		expect(artifactChunkName(ISOLATED)).toBeNull()
	})
})
