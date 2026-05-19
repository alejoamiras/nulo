import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import TokenImportRow from "./TokenImportRow.vue"

const STUBS = {
	Flex: { template: "<div><slot /></div>" },
	Spinner: { template: '<i data-testid="stub-spinner" />' },
	Icon: { template: '<i :data-name="name" />', props: ["name", "size", "color"] },
}

const baseOp = {
	id: "abc123",
	kind: "token_import" as const,
	contractAddress: "0x1234567890abcdef1234567890abcdef12345678",
	title: undefined,
	subtitle: "Adding token…",
	progress: { stage: "simulating" as const },
	error: null,
	terminalAt: null,
}

describe("TokenImportRow", () => {
	test("in-flight: renders truncated contract address as title and the configured subtitle", () => {
		const w = mount(TokenImportRow, { props: { op: baseOp }, global: { stubs: STUBS } })
		expect(w.find('[data-testid="token-import-title"]').text()).toBe("0x1234…5678")
		expect(w.find('[data-testid="token-import-subtitle"]').text()).toBe("Adding token…")
		expect(w.find('[data-testid="token-import-spinner"]').exists()).toBe(true)
		expect(w.find('[data-testid="token-import-failed"]').exists()).toBe(false)
	})

	test("in-flight: prefers explicit `op.title` over truncated address", () => {
		const w = mount(TokenImportRow, { props: { op: { ...baseOp, title: "USDC" } }, global: { stubs: STUBS } })
		expect(w.find('[data-testid="token-import-title"]').text()).toBe("USDC")
	})

	test("failed: shows close-circle icon, no spinner; subtitle falls back to error message", () => {
		const failedOp = {
			...baseOp,
			progress: { stage: "failed" as const },
			error: { kind: "metadata_fetch", message: "Could not fetch decimals", normalizedRaw: null },
			terminalAt: Date.now(),
		}
		const w = mount(TokenImportRow, { props: { op: failedOp }, global: { stubs: STUBS } })
		expect(w.find('[data-testid="token-import-spinner"]').exists()).toBe(false)
		expect(w.find('[data-testid="token-import-failed"]').exists()).toBe(true)
		expect(w.find('[data-testid="token-import-subtitle"]').text()).toBe("Could not fetch decimals")
	})

	test("failed: subtitle falls back to a generic copy if the error envelope has no message", () => {
		const failedOp = {
			...baseOp,
			progress: { stage: "failed" as const },
			error: { kind: "unknown", message: "", normalizedRaw: null },
			terminalAt: Date.now(),
		}
		const w = mount(TokenImportRow, { props: { op: failedOp }, global: { stubs: STUBS } })
		expect(w.find('[data-testid="token-import-subtitle"]').text()).toBe("Couldn't add token")
	})
})
