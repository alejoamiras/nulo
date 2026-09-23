import { DomainSeparator } from "@aztec/constants"
import { describe, expect, test } from "vitest"
import { NULO_ACCOUNT_SEED_SEP, NULO_SEPARATOR_LABELS, NULO_SIGNING_ROOT_SEP } from "./nulo-separators"

/**
 * The separator constants are consensus-critical. Three properties are pinned:
 * provenance (first 4 BE bytes of sha256(label) — recomputed here, so a label/value edit that
 * forgets its pair reds), non-collision against upstream's ONE separator namespace
 * (`DomainSeparator` — the installed 5.0.1 tree exports no other; both its sha512 and poseidon
 * call sites draw from it), and mutual distinctness.
 */
const sepFromLabel = async (label: string): Promise<number> => {
	const digest = await self.crypto.subtle.digest("SHA-256", new TextEncoder().encode(label))
	return new DataView(digest).getUint32(0, false)
}

describe("NULO-ACCOUNT-KDF v2 separators", () => {
	test("values match their sha256-of-label provenance", async () => {
		expect(await sepFromLabel(NULO_SEPARATOR_LABELS.NULO_ACCOUNT_SEED_SEP)).toBe(NULO_ACCOUNT_SEED_SEP)
		expect(await sepFromLabel(NULO_SEPARATOR_LABELS.NULO_SIGNING_ROOT_SEP)).toBe(NULO_SIGNING_ROOT_SEP)
	})

	test("no collision with any upstream DomainSeparator value", () => {
		const upstream = Object.values(DomainSeparator).filter((v): v is number => typeof v === "number")
		expect(upstream.length).toBeGreaterThan(30)
		expect(upstream).not.toContain(NULO_ACCOUNT_SEED_SEP)
		expect(upstream).not.toContain(NULO_SIGNING_ROOT_SEP)
	})

	test("the two Nulo separators are distinct", () => {
		expect(NULO_ACCOUNT_SEED_SEP).not.toBe(NULO_SIGNING_ROOT_SEP)
	})
})
