import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"

import CapabilityDetailPanel from "./CapabilityDetailPanel.vue"

/**
 * `ScopeAddress` is stubbed so the panel test stays a pure DOM test —
 * the real `<ScopeAddress>` performs an async `managers.contact` lookup
 * we don't want to wire up at this layer. The stub forwards the
 * `address` prop and exposes it as `data-scope-addr` so the assertions
 * here can verify the right addresses are routed through.
 *
 * Same shape for `<ScopeClassId>` — and critically, its stub exposes a
 * separate testid so we can assert that class IDs are NEVER rendered
 * via the address-bound stub (the v1 → v2 bug codex caught).
 */
const STUBS = {
	Flex: { template: '<div :class="$attrs.class" v-bind="$attrs"><slot /></div>', inheritAttrs: false },
	Text: { template: "<span><slot /></span>" },
	ScopeAddress: {
		template: '<span data-testid="stub-scope-address" :data-scope-addr="address" />',
		props: ["address"],
	},
	ScopeClassId: {
		template: '<span data-testid="stub-scope-class-id" :data-scope-class-id="id" />',
		props: ["id"],
	},
}

// Tests use minimal Capability shapes; cast to bypass the tagged-union
// requirements (accounts capability requires `accounts` field, etc.).
const mountPanel = (capability: Record<string, unknown>, granted = false) =>
	// biome-ignore lint/suspicious/noExplicitAny: test fixture
	mount(CapabilityDetailPanel, { props: { capability: capability as any, granted }, global: { stubs: STUBS } })

describe("composite/CapabilityDetailPanel", () => {
	test("accounts capability with canGet:true renders the v2.1 read-addresses row", () => {
		const w = mountPanel({ type: "accounts", canGet: true })
		expect(w.text()).toContain("Read your account addresses")
	})

	test("accounts capability with canCreateAuthWit:true renders the scoped-signatures row", () => {
		const w = mountPanel({ type: "accounts", canCreateAuthWit: true })
		expect(w.text()).toMatch(/Sign auth witnesses/i)
		expect(w.text()).toMatch(/scope-checked/i)
	})

	test("accounts always shows the register-tokens write-path row", () => {
		// `registerToken` lives under the accounts capability per
		// capability-map.ts:21. It's not gated by a flag; if the user grants
		// `accounts`, register_token becomes legal. Pin the disclosure.
		const w = mountPanel({ type: "accounts", canGet: true })
		expect(w.text()).toMatch(/Register tokens/i)
	})

	test("contracts capability with '*' scope shows 'Any contract'", () => {
		const w = mountPanel({ type: "contracts", contracts: "*", canRegister: true })
		expect(w.text()).toContain("Any contract")
		expect(w.text()).toContain("Register contracts")
	})

	test("contracts capability with array scope routes each address through ScopeAddress", () => {
		const w = mountPanel({
			type: "contracts",
			contracts: ["0xabc123", "0xdef456"],
			canRegister: true,
			canGetMetadata: true,
		})
		const addrs = w.findAll('[data-testid="stub-scope-address"]')
		expect(addrs).toHaveLength(2)
		expect(addrs[0].attributes("data-scope-addr")).toBe("0xabc123")
		expect(addrs[1].attributes("data-scope-addr")).toBe("0xdef456")
		expect(w.text()).toContain("Read contract metadata")
	})

	test("contractClasses capability with '*' scope shows 'Any contract class'", () => {
		const w = mountPanel({ type: "contractClasses", classes: "*" })
		expect(w.text()).toContain("Any contract class")
	})

	test("contractClasses class IDs render via ScopeClassId, never ScopeAddress", () => {
		// codex final-pass finding: AddressDisplay (and by extension our
		// ScopeAddress) auto-resolves contact names. Class IDs are not
		// addresses; routing them through ScopeAddress would mislabel any
		// class whose hex matches a saved contact.
		const w = mountPanel({
			type: "contractClasses",
			classes: ["0xclass1", "0xclass2"],
			canGetMetadata: true,
		})
		const classIds = w.findAll('[data-testid="stub-scope-class-id"]')
		expect(classIds).toHaveLength(2)
		expect(classIds[0].attributes("data-scope-class-id")).toBe("0xclass1")
		expect(w.find('[data-testid="stub-scope-address"]').exists()).toBe(false)
	})

	test("transaction scope renders raw method id even when humanizable", () => {
		// `transfer_in_private` IS in METHOD_LABELS (collapses to "Transfer
		// (private)"). The friendly label must NOT replace the raw — both
		// must appear so a careful user can verify the underlying method.
		const w = mountPanel({
			type: "transaction",
			scope: [{ contract: "0xtoken", function: "transfer_in_private" }],
		})
		expect(w.text()).toContain("transfer_in_private")
		expect(w.text()).toContain("Transfer (private)")
	})

	test("transaction scope with an unrecognized function shows ONLY the raw id (no tautological title-cased annotation)", () => {
		const w = mountPanel({
			type: "transaction",
			scope: [{ contract: "0xfoo", function: "totally_made_up_fn" }],
		})
		expect(w.text()).toContain("totally_made_up_fn")
		// No "Totally Made Up Fn" annotation — that's the humanizeMethodName
		// behavior we deliberately avoid in the capability panel.
		expect(w.text()).not.toMatch(/Totally Made Up/i)
	})

	test("transaction panel preserves the load-bearing approval clause verbatim", () => {
		// dapp-interaction/service.ts:354-362 forces the execute popup for
		// every sendTx under default policy. This clause is the user-visible
		// promise that matches that behavior — pin it.
		const w = mountPanel({ type: "transaction", scope: "*" })
		expect(w.text()).toContain("Each transaction still requires your approval")
	})

	test("simulation transaction scope routes scope contracts through ScopeAddress, not ScopeClassId", () => {
		const w = mountPanel({
			type: "simulation",
			transactions: { scope: [{ contract: "0xsim", function: "preview" }] },
		})
		const addrs = w.findAll('[data-testid="stub-scope-address"]')
		expect(addrs).toHaveLength(1)
		expect(addrs[0].attributes("data-scope-addr")).toBe("0xsim")
	})

	test("data capability always shows the register-senders write-path row", () => {
		const w = mountPanel({ type: "data", addressBook: true })
		expect(w.text()).toMatch(/Register senders/i)
		expect(w.text()).toMatch(/Read address book/i)
	})

	test("unknown capability shows the constant reject-if-unsure copy + sanitized type", () => {
		const w = mountPanel({ type: "Weird-cap_NAME — recommended (FAKE)" })
		expect(w.text()).toContain("This wallet doesn't recognize this permission")
		// The raw type is rendered through sanitizeWireString. The test fixture
		// has no bidi / control chars so the only sanitization is length-clamp
		// (32 chars). The fixture happens to be exactly 32 chars long, so it
		// renders verbatim; a longer string would clamp + ellipsis.
		expect(w.text()).toMatch(/Weird-cap_NAME/)
	})

	test("unknown capability sanitizer clamps over-length type strings", () => {
		const longType = "x".repeat(80)
		const w = mountPanel({ type: longType })
		// 32-char clamp + ellipsis = 33 codepoints in the rendered type row.
		expect(w.text()).toMatch(/x{32}…/)
		expect(w.text()).not.toMatch(/x{33}/)
	})

	test("granted=true applies the 'granted' style modifier", () => {
		const w = mountPanel({ type: "accounts", canGet: true }, true)
		expect(w.html()).toMatch(/granted/)
	})
})
