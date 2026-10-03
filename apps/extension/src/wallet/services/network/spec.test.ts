import { describe, expect, test } from "vitest"
import { type Network, networkInfoFrom, primaryEndpointUrl, RpcUrlSchema } from "./spec"

// The schema's acceptance set is a security boundary: these rows pin it input by input. The
// adapter's own table (aztec-node-factory-adapter.test.ts) covers the same inputs, so a row whose
// verdict differs between the two files is a deliberate policy difference (userinfo, Unicode space).
const ACCEPTED = [
	"https://rpc.example.com",
	"HTTPS://RPC.EXAMPLE.COM/Path?Q=1",
	"https://@b.example",
	"http://localhost:8080",
	"HTTP://localhost:8080",
	"http://LOCALHOST:8080",
	"http://127.0.0.1:8080",
	"http://127.1:8080",
	"http://[::1]:8080",
	"http://[0:0:0:0:0:0:0:1]:8080",
	"https://[2001:db8::1]:8443",
	"https://exämple.com",
	" https://rpc.example.com",
	"https://rpc.example.com ",
	" https://rpc.example.com",
	"https://rpc.example.com/path ",
	"https://rpc.example.com/?q=x ",
	"https:rpc.example.com",
	"http://localhost\\@evil.com",
]

const REFUSED = [
	"https://a@b.example",
	"https://user:pass@b.example",
	"https://user@evil.com@safe.com",
	"http://user@localhost:8080",
	"http://localhost.:8080",
	"http://sub.localhost:8080",
	"http://127.0.0.2:8080",
	"http://0.0.0.0:8080",
	"http://[::ffff:127.0.0.1]:8080",
	"https://rpc.example.com:65536",
	"",
	"ws://localhost:8080",
	"javascript:alert(1)",
	"file:///etc/passwd",
	"localhost:8080",
]

describe("RpcUrlSchema", () => {
	test.each(ACCEPTED)("accepts %j", (url) => {
		expect(RpcUrlSchema.safeParse(url).success).toBe(true)
	})

	test.each(REFUSED)("refuses %j", (url) => {
		expect(RpcUrlSchema.safeParse(url).success).toBe(false)
	})

	test("a URL that parses but fails the allowlist carries the refine's message", () => {
		const result = RpcUrlSchema.safeParse("http://example.com")
		expect(result.success).toBe(false)
		expect(result.error?.issues.map((i) => i.message)).toEqual([
			"RPC URL must use https:// or http://localhost / http://127.0.0.1 / http://[::1] and contain no userinfo",
		])
	})
})

const network = (over: Partial<Network> = {}): Network => ({
	id: "n1",
	profileId: "p1",
	chainId: 7,
	l1ChainId: 1,
	name: "Seven",
	primaryEndpointId: "e2",
	endpoints: [
		{ id: "e1", rpcUrl: "https://one.example" },
		{ id: "e2", rpcUrl: "https://two.example" },
	],
	kind: "custom",
	...over,
})

describe("networkInfoFrom", () => {
	test("projects the primary endpoint's URL, not the first endpoint's", () => {
		expect(networkInfoFrom(network())).toEqual({ profileId: "p1", chainId: 7, rpcUrl: "https://two.example" })
	})

	test("a primaryEndpointId that names no endpoint throws", () => {
		expect(() => networkInfoFrom(network({ primaryEndpointId: "gone" }))).toThrow(new Error("Network n1 has no primary endpoint"))
	})
})

describe("primaryEndpointUrl", () => {
	test("the primary endpoint's URL", () => {
		expect(primaryEndpointUrl(network())).toBe("https://two.example")
	})

	test("undefined for a dangling primaryEndpointId, never the first endpoint", () => {
		expect(primaryEndpointUrl(network({ primaryEndpointId: "gone" }))).toBeUndefined()
	})

	test("undefined for a row with no endpoints array", () => {
		expect(primaryEndpointUrl(network({ endpoints: undefined as never }))).toBeUndefined()
	})
})
