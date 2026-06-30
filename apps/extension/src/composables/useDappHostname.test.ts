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
