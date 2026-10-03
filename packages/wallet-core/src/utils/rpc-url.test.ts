import { describe, expect, test } from "vitest"
import { rpcTransportVerdict } from "./rpc-url"

describe("rpcTransportVerdict", () => {
	test.each([
		["https://user@rpc.example.com", { allowed: true }],
		["http://[::1]:8080", { allowed: true }],
		["http://LOCALHOST.:8080", { allowed: false, refusal: "non-loopback-http", host: "localhost." }],
		["ws://localhost:8080", { allowed: false, refusal: "scheme", scheme: "ws" }],
	])("%j → %j", (url, verdict) => {
		expect(rpcTransportVerdict(new URL(url))).toEqual(verdict)
	})
})
