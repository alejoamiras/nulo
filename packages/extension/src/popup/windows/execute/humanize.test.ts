import { describe, expect, it } from "vitest"
import { humanizeOperationKind } from "./humanize"

describe("humanizeOperationKind", () => {
	it("strips aztec_ prefix and splits camelCase", () => {
		expect(humanizeOperationKind("aztec_sendTx")).toBe("Send tx")
		expect(humanizeOperationKind("aztec_simulateTx")).toBe("Simulate tx")
		expect(humanizeOperationKind("aztec_executeUtility")).toBe("Execute utility")
		expect(humanizeOperationKind("aztec_profileTx")).toBe("Profile tx")
	})

	it("preserves AuthWit and PXE tokens (special-cased so they don't split mid-word)", () => {
		expect(humanizeOperationKind("aztec_createAuthWit")).toBe("Create authwit")
	})

	it("handles multi-word camelCase aztec_ kinds", () => {
		expect(humanizeOperationKind("aztec_getContractMetadata")).toBe("Get contract metadata")
		expect(humanizeOperationKind("aztec_getContractClassMetadata")).toBe("Get contract class metadata")
		expect(humanizeOperationKind("aztec_getPrivateEvents")).toBe("Get private events")
		expect(humanizeOperationKind("aztec_getAddressBook")).toBe("Get address book")
	})

	it("splits snake_case kinds and capitalizes the first letter (single underscore)", () => {
		expect(humanizeOperationKind("send_transaction")).toBe("Send transaction")
		expect(humanizeOperationKind("register_contract")).toBe("Register contract")
		expect(humanizeOperationKind("register_sender")).toBe("Register sender")
		expect(humanizeOperationKind("register_token")).toBe("Register token")
		expect(humanizeOperationKind("simulate_views")).toBe("Simulate views")
	})

	it("replaces ALL underscores in multi-underscore snake_case kinds", () => {
		// `String.prototype.replace(string, ...)` is non-global and would fix
		// only the first underscore. `replaceAll` covers every underscore. We
		// don't currently ship any multi-underscore op kind (the prior
		// `get_complete_address` was retired), so test the function purely
		// against a synthetic kind to guard against accidental reversion to
		// `replace`.
		expect(humanizeOperationKind("hypothetical_multi_underscore_kind")).toBe("Hypothetical multi underscore kind")
	})

	it("returns empty string for empty input (no crash)", () => {
		expect(humanizeOperationKind("")).toBe("")
	})

	it("handles a kind without a prefix or underscore", () => {
		expect(humanizeOperationKind("foobar")).toBe("Foobar")
	})
})
