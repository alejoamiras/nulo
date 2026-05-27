import { describe, expect, test } from "vitest"
import { classifyEndpointError, type FailureClassification } from "./error-classifier"

const expectKind = (err: unknown, kind: FailureClassification["kind"]) => {
	const out = classifyEndpointError(err)
	expect(out.kind, `${kind} expected, got ${out.kind}: ${out.reason}`).toBe(kind)
	return out
}

describe("network/classifyEndpointError", () => {
	test("undefined / null are ignored (no error to classify)", () => {
		expectKind(undefined, "ignore")
		expectKind(null, "ignore")
	})

	test("user abort is ignored (DOMException AbortError)", () => {
		const err =
			typeof DOMException !== "undefined"
				? new DOMException("aborted", "AbortError")
				: Object.assign(new Error("aborted"), { name: "AbortError" })
		expectKind(err, "ignore")
	})

	test("Error with name=AbortError is ignored (env without DOMException)", () => {
		const err = Object.assign(new Error("aborted"), { name: "AbortError" })
		expectKind(err, "ignore")
	})

	test("HTTP 500 is hard", () => {
		expectKind({ status: 500, message: "server error" }, "hard")
	})

	test("HTTP 502 is hard", () => {
		expectKind({ status: 502 }, "hard")
	})

	test("HTTP 429 is hard (rate-limit signals unusability)", () => {
		expectKind({ status: 429 }, "hard")
	})

	test("HTTP 503 is hard", () => {
		expectKind({ statusCode: 503 }, "hard")
	})

	test("HTTP 4xx (not 429) is soft", () => {
		expectKind({ status: 404 }, "soft")
		expectKind({ status: 401 }, "soft")
	})

	test("JSON-RPC -32603 (internal error) is hard", () => {
		expectKind({ code: -32603, message: "Internal error" }, "hard")
	})

	test("JSON-RPC -32000..-32099 (server-defined) is hard", () => {
		expectKind({ code: -32000 }, "hard")
		expectKind({ code: -32099 }, "hard")
		expectKind({ code: -32050 }, "hard")
	})

	test("JSON-RPC -32600/-32601/-32602 (client bug) is ignored", () => {
		expectKind({ code: -32600, message: "Invalid request" }, "ignore")
		expectKind({ code: -32601, message: "Method not found" }, "ignore")
		expectKind({ code: -32602, message: "Invalid params" }, "ignore")
	})

	test("chainId mismatch (ERR_ENDPOINT_CHAIN_MISMATCH) is evict (permanent session quarantine)", () => {
		const out = classifyEndpointError(new Error("ENDPOINT_CHAIN_MISMATCH: chainId 7 != 11155111"))
		expect(out.kind).toBe("evict")
	})

	test("TypeError with fetch-failed message is hard transport", () => {
		expectKind(new TypeError("Failed to fetch"), "hard")
	})

	test("ECONNREFUSED in error message is hard transport", () => {
		expectKind(new Error("connect ECONNREFUSED 127.0.0.1:8080"), "hard")
	})

	test("TLS error in message is hard transport", () => {
		expectKind(new Error("self signed certificate"), "hard")
	})

	test("'timeout' / 'overloaded' / 'unavailable' phrases are hard", () => {
		expectKind(new Error("request timeout"), "hard")
		expectKind(new Error("server overloaded"), "hard")
		expectKind(new Error("Service Unavailable"), "hard")
	})

	test("uncategorized error is ignored (conservative default)", () => {
		expectKind(new Error("some weird domain-level error"), "ignore")
	})

	test("HTTP 200 + parse error reaches us as 'ignore' (semantically the endpoint replied)", () => {
		// We can't always distinguish "wallet parser bug" from "endpoint returned garbage"
		// — but anything without a structured status/code field defaults to ignore so we
		// don't fail over for our own bugs.
		expectKind(new Error("Unexpected token in JSON"), "ignore")
	})

	test("classification reason is non-empty for every bucket", () => {
		// Spot-check: every test above has a reason string we can show in logs.
		expect(classifyEndpointError({ status: 500 }).reason.length).toBeGreaterThan(0)
		expect(classifyEndpointError(new Error("x")).reason.length).toBeGreaterThan(0)
	})
})
