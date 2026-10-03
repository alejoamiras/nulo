import { describe, expect, test } from "vitest"
import { ref } from "vue"
import { useDappHostname } from "./useDappHostname"

describe("composables/useDappHostname", () => {
	test("hostname is empty when dapp is null", () => {
		const dapp = ref(null)
		const { hostname } = useDappHostname(dapp)
		expect(hostname.value).toBe("")
	})

	test("hostname is empty when url is missing", () => {
		const dapp = ref({})
		const { hostname } = useDappHostname(dapp)
		expect(hostname.value).toBe("")
	})

	test("normalizes URL down to its hostname", () => {
		const dapp = ref({ url: "https://example.com/path?q=1" })
		const { hostname } = useDappHostname(dapp)
		expect(hostname.value).toBe("example.com")
	})

	test("falls back to the raw value when URL parsing throws", () => {
		const dapp = ref({ url: "not a url" })
		const { hostname } = useDappHostname(dapp)
		expect(hostname.value).toBe("not a url")
	})

	test("plain ASCII hostnames are NOT flagged suspicious", () => {
		const dapp = ref({ url: "https://example.com" })
		const { isSuspicious } = useDappHostname(dapp)
		expect(isSuspicious.value).toBe(false)
	})

	test("non-ASCII URLs surface punycode-encoded hostnames flagged suspicious", () => {
		// `new URL()` punycode-encodes the hostname; the punycode prefix
		// itself triggers the suspicious flag downstream.
		const dapp = ref({ url: "https://exámple.com" })
		const { hostname, isSuspicious } = useDappHostname(dapp)
		expect(hostname.value.startsWith("xn--")).toBe(true)
		expect(isSuspicious.value).toBe(true)
	})

	test("punycode (xn-- prefix) labels are flagged suspicious", () => {
		const dapp = ref({ url: "https://xn--exmple-cua.com" })
		const { isSuspicious } = useDappHostname(dapp)
		expect(isSuspicious.value).toBe(true)
	})

	test("reactive: updating the dapp ref re-derives both values", () => {
		const dapp = ref<{ url?: string } | null>({ url: "https://safe.com" })
		const { hostname, isSuspicious } = useDappHostname(dapp)
		expect(hostname.value).toBe("safe.com")
		expect(isSuspicious.value).toBe(false)

		dapp.value = { url: "https://xn--exmple-cua.com" }
		expect(isSuspicious.value).toBe(true)
	})
})

/**
 * Origins as the SDK serializes a tab URL (`new URL(tab.url).origin`, or "unknown"), plus the
 * raw strings a stored row could carry. Values hold on Bun, jsdom, Chrome and Firefox; inputs whose
 * parse differs by engine (`https://xn--.example`, a space inside the host) are left out.
 */
describe("composables/useDappHostname — hostile origins", () => {
	test.each([
		["https://dapp.example", "dapp.example", false],
		["https://DApp.EXAMPLE", "dapp.example", false],
		["https://dapp.example.", "dapp.example.", false],
		["https://dapp.example:8443", "dapp.example", false],
		["http://dapp.example", "dapp.example", false],
		["https://dapp.example/path?q=1#h", "dapp.example", false],
		["https://user:pw@dapp.example", "dapp.example", false],
		["https://dapp.example@evil.example", "evil.example", false],
		["https://dapp.example%40evil.example", "https://dapp.example%40evil.example", false],
		["http://[::1]:5173", "[::1]", false],
		["https://[::ffff:127.0.0.1]", "[::ffff:7f00:1]", false],
		["https://0x7f.1", "127.0.0.1", false],
		["https://dapp.example.evil.example", "dapp.example.evil.example", false],
		["https://dapp-example.com", "dapp-example.com", false],
		["https://exámple.com", "xn--exmple-qta.com", true],
		["https://аpple.com", "xn--pple-43d.com", true],
		["https://XN--EXMPLE-CUA.com", "xn--exmple-cua.com", true],
		["https://a.xn--p1ai", "a.xn--p1ai", true],
		["https://ｄａｐｐ.example", "dapp.example", false],
		["https://dapp.ex­ample", "dapp.example", false],
		["https://dapp.ex​ample", "dapp.example", false],
		["https://dapp.example。evil", "dapp.example.evil", false],
		["null", "null", false],
		["unknown", "unknown", false],
		["file:///etc/passwd", "", false],
		["exámple", "exámple", true],
		["xn--exmple-cua", "xn--exmple-cua", true],
		["XN--EXMPLE-CUA", "XN--EXMPLE-CUA", false],
	])("%s → %s, flagged %s", (url, hostname, suspicious) => {
		const view = useDappHostname(ref({ url }))
		expect(view.hostname.value).toBe(hostname)
		expect(view.isSuspicious.value).toBe(suspicious)
	})
})
